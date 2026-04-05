const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "src", "generated", "prisma", "index.ts");
const content = `export { PrismaClient } from "./client";
export * from "./enums";
export type * from "./client";
export type * from "./models";
`;

fs.writeFileSync(indexPath, content, "utf-8");
console.log("Created src/generated/prisma/index.ts");
