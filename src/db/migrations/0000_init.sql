CREATE TYPE "public"."card_status" AS ENUM('inactive', 'active', 'frozen', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'cardholder');--> statement-breakpoint
CREATE TYPE "public"."spending_period" AS ENUM('monthly');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'settled', 'declined');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('purchase', 'refund');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"holder_user_id" uuid NOT NULL,
	"last4" char(4) NOT NULL,
	"expiry_month" smallint NOT NULL,
	"expiry_year" smallint NOT NULL,
	"status" "card_status" DEFAULT 'inactive' NOT NULL,
	"image_url" text NOT NULL,
	"spending_limit_minor_units" bigint NOT NULL,
	"spending_period" "spending_period" DEFAULT 'monthly' NOT NULL,
	"currency" char(3) NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_id_currency_unique" UNIQUE("id","currency"),
	CONSTRAINT "cards_expiry_month_check" CHECK ("cards"."expiry_month" between 1 and 12),
	CONSTRAINT "cards_spending_limit_check" CHECK ("cards"."spending_limit_minor_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organisation_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_organisation_number_unique" UNIQUE("organisation_number")
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_memberships_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_check" CHECK ("invoices"."amount_minor_units" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"merchant_name" text NOT NULL,
	"category" text NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."amount_minor_units" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_currency_fk" FOREIGN KEY ("card_id","currency") REFERENCES "public"."cards"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_company_holder_idx" ON "cards" USING btree ("company_id","holder_user_id");--> statement-breakpoint
CREATE INDEX "company_memberships_company_idx" ON "company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "invoices_company_status_due_idx" ON "invoices" USING btree ("company_id","status","due_date");--> statement-breakpoint
CREATE INDEX "transactions_card_occurred_idx" ON "transactions" USING btree ("card_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);