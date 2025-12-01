# Photos by Vedant Modi

Full application for my photos display.

## Frontend

Lives at `src/app` and requires the photos to be loaded in the `public/` directory to render.
Start the web application with `npm run dev`.

## Backend

Lives mainly at `scripts` and has two steps, ingestion and processing.

Ingestion is an interactive step that allows the user to preview each photo and add a caption to display on each image's display. You must have `exiftool` installed in order for this application to work. If you have iterm2 running, then the image thumbnail will be put to stdout for your viewing. Ingestion assumes that the photos that you wish to add live at `<root>/photos/`. Note that `<root>/photos/` is ignored by the repository so retaining the contents of this directory is your responsibilty.

Run ingestion with `npm run ingest`.

Processing scrapes the EXIF data from each photo and prepares them for web-friendly display. When this script is run it will take the photos in `<root>/photos/` and generate web-friendly photos in `<root>/public/photos`. A thumbnail and large version will be generated in that directory. An accompanying `<root>/public/data.json` will be generated as well. This is the file that the frontend application with interface with.

Run ingestion with `npm run process`.
