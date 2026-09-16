# Raw dataset drop folder

Place the original hackathon source files here, keeping their original filenames:

- CUI Tagging Dataset ZIP, or its category/LDC manifests and chunk JSONL.
- 8801 Seminar 12 synthetic forum JSON (and accompanying PDF if available).
- 8670 EWS prerequisite coursebook PDF.

Raw contents of this directory are gitignored; this README is the exception.
The coursebook PDF must not be committed. Once files are available, inspect the
actual source schemas before extracting normalized vocabulary into `data/cui/`
and derived synthetic fixtures into `portal/data/`.
