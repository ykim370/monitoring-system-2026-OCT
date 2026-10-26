CREATE TABLE `radar_connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`encrypted_secret` text,
	`snapshot` text,
	`context` text DEFAULT '{}' NOT NULL,
	`last_refresh` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
