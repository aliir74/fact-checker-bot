.PHONY: dev deploy test db-local db-remote secret-telegram secret-openrouter secret-google secret-webhook

dev:
	pnpm dev

deploy:
	pnpm deploy

test:
	pnpm test

db-local:
	pnpm db:migrate:local

db-remote:
	pnpm db:migrate:remote

secret-telegram:
	wrangler secret put TELEGRAM_BOT_TOKEN

secret-openrouter:
	wrangler secret put OPENROUTER_API_KEY

secret-google:
	wrangler secret put GOOGLE_FACT_CHECK_API_KEY

secret-webhook:
	wrangler secret put TELEGRAM_WEBHOOK_SECRET
