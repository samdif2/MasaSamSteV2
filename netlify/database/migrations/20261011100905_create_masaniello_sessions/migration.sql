CREATE TABLE "masaniello_sessions" (
	"code" varchar(32) PRIMARY KEY,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
