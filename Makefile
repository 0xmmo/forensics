.PHONY: serve

serve:
	npx nodemon --watch src --ext ts,js,json --exec "tsx src/server.ts"
