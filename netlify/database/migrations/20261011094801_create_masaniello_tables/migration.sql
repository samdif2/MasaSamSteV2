CREATE TABLE "masaniello_events" (
	"id" serial PRIMARY KEY,
	"match_name" varchar(255) NOT NULL,
	"selection" varchar(64) NOT NULL,
	"odds" numeric(8,3) NOT NULL,
	"stake" numeric(14,2) NOT NULL,
	"status" varchar(16) DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "masaniello_settings" (
	"id" serial PRIMARY KEY,
	"initial_bankroll" numeric(14,2) NOT NULL,
	"total_events_n" integer NOT NULL,
	"expected_events_k" integer NOT NULL,
	"average_odds" numeric(8,3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_matches_list" (
	"id" serial PRIMARY KEY,
	"raw_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
