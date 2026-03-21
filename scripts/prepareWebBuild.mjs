import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const sourceDir = path.join(process.cwd(), "apps", "web");
const outputDir = path.join(process.cwd(), "dist", "web");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true, force: true });

console.log(`Prepared static web build in ${outputDir}`);
