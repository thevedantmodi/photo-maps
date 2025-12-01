# Photo Maps Workflow

Since your raw photos are too large for GitHub, we will use a **Local Processing** workflow.

## 1. Add Photos
Put your raw photos (HEIC, DNG, JPG) into the `photos/` folder on your computer.
*   These files are **ignored** by git, so they won't clog up your repo.

## 2. Ingest & Tag (Optional)
Run the ingest script to review photos and add captions.
```bash
npm run ingest
```

## 3. Process Photos
Run the processing script to generate optimized web-ready images.
```bash
npm run process
```
*   This creates small thumbnails and optimized large images in `public/photos/`.
*   It also updates `public/data.json`.

## 4. Deploy
Commit the **optimized** images and push to GitHub.
```bash
git add public/photos public/data.json
git commit -m "Add new photos"
git push
```
*   Vercel will detect the push and update your site automatically.
