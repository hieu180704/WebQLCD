CREATE TABLE "login_throttles" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "login_throttles_scope_key_pk" PRIMARY KEY("scope","key"),
	CONSTRAINT "login_throttles_scope" CHECK ("login_throttles"."scope" IN ('ip', 'user')),
	CONSTRAINT "login_throttles_attempts_non_negative" CHECK ("login_throttles"."attempts" >= 0)
);
