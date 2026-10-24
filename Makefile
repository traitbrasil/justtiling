.PHONY: test test-shell test-preferences check check-api package test-package submission

test:
	gjs -m tests/run.js

test-shell:
	python3 tools/test-shell.py

test-package:
	gjs -m tests/package-lookup-smoke.js

test-preferences:
	python3 tools/test-preferences.py

check:
	gjs -m tools/check-syntax.js
	glib-compile-schemas --strict --dry-run schemas

check-api:
	python3 tools/check-api.py

package: check test
	python3 tools/build.py

submission: package
	python3 tools/check-submission.py
