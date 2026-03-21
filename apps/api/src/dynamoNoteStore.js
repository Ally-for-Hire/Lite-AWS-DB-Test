import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { HttpError } from "./errors.js";

const META_SK = "META";
const VERSION_PREFIX = "VER#";
const NOTES_INDEX_PK = "NOTE";

function isoNow() {
  return new Date().toISOString();
}

function notePk(noteId) {
  return `NOTE#${noteId}`;
}

function versionSk(versionNumber) {
  return `${VERSION_PREFIX}${String(versionNumber).padStart(10, "0")}`;
}

function versionPrefix() {
  return VERSION_PREFIX;
}

function mapMeta(item) {
  return {
    noteId: item.noteId,
    title: item.title,
    currentVersion: item.currentVersion,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function mapVersion(item, currentVersion) {
  return {
    noteId: item.noteId,
    version: item.version,
    title: item.title,
    content: item.content,
    editedAt: item.editedAt,
    source: item.source,
    baseVersion: item.baseVersion ?? null,
    isCurrent: currentVersion === item.version
  };
}

function mapVersionSummary(item) {
  return {
    version: item.version,
    editedAt: item.editedAt,
    source: item.source,
    title: item.title,
    baseVersion: item.baseVersion ?? null
  };
}

function isConflictError(error) {
  return error?.name === "ConditionalCheckFailedException" || error?.name === "TransactionCanceledException";
}

export class DynamoNoteStore {
  constructor({ tableName, client }) {
    this.tableName = tableName;
    this.client =
      client ||
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: {
          removeUndefinedValues: true
        }
      });
  }

  async init() {}

  async listNotes() {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :partitionKey",
        ExpressionAttributeValues: {
          ":partitionKey": NOTES_INDEX_PK
        },
        ScanIndexForward: false
      })
    );

    return (result.Items || []).map(mapMeta);
  }

  async createNote({ title, content }) {
    const noteId = randomUUID();
    const createdAt = isoNow();
    const pk = notePk(noteId);

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: pk,
                  SK: META_SK,
                  entityType: "NOTE_META",
                  GSI1PK: NOTES_INDEX_PK,
                  GSI1SK: `${createdAt}#${noteId}`,
                  noteId,
                  title,
                  currentVersion: 1,
                  createdAt,
                  updatedAt: createdAt
                },
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: pk,
                  SK: versionSk(1),
                  entityType: "NOTE_VERSION",
                  noteId,
                  version: 1,
                  title,
                  content,
                  editedAt: createdAt,
                  source: "create",
                  baseVersion: null
                },
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
              }
            }
          ]
        })
      );
    } catch (error) {
      if (isConflictError(error)) {
        throw new HttpError(409, "Conflict", "Note already exists");
      }

      throw error;
    }

    return {
      noteId,
      currentVersion: 1,
      title,
      content
    };
  }

  async getNote(noteId) {
    const meta = await this.#getRequiredMeta(noteId);
    const version = await this.#getRequiredVersion(noteId, meta.currentVersion);

    return {
      noteId: meta.noteId,
      title: version.title,
      content: version.content,
      currentVersion: meta.currentVersion,
      updatedAt: meta.updatedAt
    };
  }

  async updateNote(noteId, { title, content, expectedCurrentVersion }) {
    const meta = await this.#getRequiredMeta(noteId);

    if (meta.currentVersion !== expectedCurrentVersion) {
      throw new HttpError(409, "Conflict", "Version mismatch");
    }

    const latestVersion = await this.#getLatestVersionNumber(noteId);
    const nextVersionNumber = latestVersion + 1;
    const editedAt = isoNow();
    const pk = notePk(noteId);

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: pk,
                  SK: versionSk(nextVersionNumber),
                  entityType: "NOTE_VERSION",
                  noteId,
                  version: nextVersionNumber,
                  title,
                  content,
                  editedAt,
                  source: "edit",
                  baseVersion: expectedCurrentVersion
                },
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
              }
            },
            {
              Update: {
                TableName: this.tableName,
                Key: {
                  PK: pk,
                  SK: META_SK
                },
                UpdateExpression:
                  "SET #title = :title, currentVersion = :currentVersion, updatedAt = :updatedAt, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
                ConditionExpression: "currentVersion = :expectedCurrentVersion",
                ExpressionAttributeNames: {
                  "#title": "title"
                },
                ExpressionAttributeValues: {
                  ":title": title,
                  ":currentVersion": nextVersionNumber,
                  ":updatedAt": editedAt,
                  ":expectedCurrentVersion": expectedCurrentVersion,
                  ":gsi1pk": NOTES_INDEX_PK,
                  ":gsi1sk": `${editedAt}#${noteId}`
                }
              }
            }
          ]
        })
      );
    } catch (error) {
      if (isConflictError(error)) {
        throw new HttpError(409, "Conflict", "Version mismatch");
      }

      throw error;
    }

    return {
      noteId,
      currentVersion: nextVersionNumber
    };
  }

  async listVersions(noteId) {
    await this.#getRequiredMeta(noteId);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :versionPrefix)",
        ExpressionAttributeValues: {
          ":pk": notePk(noteId),
          ":versionPrefix": versionPrefix()
        },
        ScanIndexForward: false
      })
    );

    return (result.Items || []).map(mapVersionSummary);
  }

  async getVersion(noteId, versionNumber) {
    const [meta, version] = await Promise.all([
      this.#getRequiredMeta(noteId),
      this.#getRequiredVersion(noteId, versionNumber)
    ]);

    return mapVersion(version, meta.currentVersion);
  }

  async undo(noteId) {
    const meta = await this.#getRequiredMeta(noteId);

    if (meta.currentVersion <= 1) {
      throw new HttpError(409, "Conflict", "Cannot undo past version 1");
    }

    const targetVersion = await this.#getRequiredVersion(noteId, meta.currentVersion - 1);
    const updatedAt = isoNow();

    try {
      await this.#updatePointer({
        noteId,
        fromVersion: meta.currentVersion,
        toVersion: targetVersion.version,
        title: targetVersion.title,
        updatedAt
      });
    } catch (error) {
      if (isConflictError(error)) {
        throw new HttpError(409, "Conflict", "Version changed before undo completed");
      }

      throw error;
    }

    return {
      noteId,
      currentVersion: targetVersion.version
    };
  }

  async redo(noteId) {
    const meta = await this.#getRequiredMeta(noteId);
    const targetVersion = await this.#getVersionIfExists(noteId, meta.currentVersion + 1);

    if (!targetVersion) {
      throw new HttpError(409, "Conflict", "Cannot redo because no newer version exists");
    }

    const updatedAt = isoNow();

    try {
      await this.#updatePointer({
        noteId,
        fromVersion: meta.currentVersion,
        toVersion: targetVersion.version,
        title: targetVersion.title,
        updatedAt
      });
    } catch (error) {
      if (isConflictError(error)) {
        throw new HttpError(409, "Conflict", "Version changed before redo completed");
      }

      throw error;
    }

    return {
      noteId,
      currentVersion: targetVersion.version
    };
  }

  async restoreVersion(noteId, versionNumber) {
    const [meta, restoredVersion, latestVersion] = await Promise.all([
      this.#getRequiredMeta(noteId),
      this.#getRequiredVersion(noteId, versionNumber),
      this.#getLatestVersionNumber(noteId)
    ]);
    const nextVersionNumber = latestVersion + 1;
    const editedAt = isoNow();
    const pk = notePk(noteId);

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: pk,
                  SK: versionSk(nextVersionNumber),
                  entityType: "NOTE_VERSION",
                  noteId,
                  version: nextVersionNumber,
                  title: restoredVersion.title,
                  content: restoredVersion.content,
                  editedAt,
                  source: "restore",
                  baseVersion: versionNumber
                },
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
              }
            },
            {
              Update: {
                TableName: this.tableName,
                Key: {
                  PK: pk,
                  SK: META_SK
                },
                UpdateExpression:
                  "SET #title = :title, currentVersion = :currentVersion, updatedAt = :updatedAt, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
                ConditionExpression: "currentVersion = :expectedCurrentVersion",
                ExpressionAttributeNames: {
                  "#title": "title"
                },
                ExpressionAttributeValues: {
                  ":title": restoredVersion.title,
                  ":currentVersion": nextVersionNumber,
                  ":updatedAt": editedAt,
                  ":expectedCurrentVersion": meta.currentVersion,
                  ":gsi1pk": NOTES_INDEX_PK,
                  ":gsi1sk": `${editedAt}#${noteId}`
                }
              }
            }
          ]
        })
      );
    } catch (error) {
      if (isConflictError(error)) {
        throw new HttpError(409, "Conflict", "Version changed before restore completed");
      }

      throw error;
    }

    return {
      noteId,
      currentVersion: nextVersionNumber,
      restoredFrom: versionNumber
    };
  }

  async #updatePointer({ noteId, fromVersion, toVersion, title, updatedAt }) {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: notePk(noteId),
          SK: META_SK
        },
        UpdateExpression:
          "SET #title = :title, currentVersion = :currentVersion, updatedAt = :updatedAt, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
        ConditionExpression: "currentVersion = :expectedCurrentVersion",
        ExpressionAttributeNames: {
          "#title": "title"
        },
        ExpressionAttributeValues: {
          ":title": title,
          ":currentVersion": toVersion,
          ":updatedAt": updatedAt,
          ":expectedCurrentVersion": fromVersion,
          ":gsi1pk": NOTES_INDEX_PK,
          ":gsi1sk": `${updatedAt}#${noteId}`
        }
      })
    );
  }

  async #getRequiredMeta(noteId) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: notePk(noteId),
          SK: META_SK
        }
      })
    );

    if (!result.Item) {
      throw new HttpError(404, "NotFound", "Note not found");
    }

    return result.Item;
  }

  async #getRequiredVersion(noteId, versionNumber) {
    const version = await this.#getVersionIfExists(noteId, versionNumber);

    if (!version) {
      throw new HttpError(404, "NotFound", "Version not found");
    }

    return version;
  }

  async #getVersionIfExists(noteId, versionNumber) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: notePk(noteId),
          SK: versionSk(versionNumber)
        }
      })
    );

    return result.Item || null;
  }

  async #getLatestVersionNumber(noteId) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :versionPrefix)",
        ExpressionAttributeValues: {
          ":pk": notePk(noteId),
          ":versionPrefix": versionPrefix()
        },
        ScanIndexForward: false,
        Limit: 1
      })
    );

    const latestVersion = result.Items?.[0];

    if (!latestVersion) {
      throw new HttpError(500, "InternalError", "Note history is missing");
    }

    return latestVersion.version;
  }
}
