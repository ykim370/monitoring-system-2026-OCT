import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
export const workspaces=sqliteTable("workspaces",{owner:text("owner").primaryKey(), revision:integer("revision").notNull(),data:text("data").notNull(),updatedAt:text("updated_at").notNull()});
export const auditEvents=sqliteTable("audit_events",{id:integer("id").primaryKey({autoIncrement:true}),owner:text("owner").notNull(),revision:integer("revision").notNull(),payload:text("payload").notNull(),createdAt:text("created_at").notNull()},table=>[uniqueIndex("owner_revision").on(table.owner,table.revision)]);
