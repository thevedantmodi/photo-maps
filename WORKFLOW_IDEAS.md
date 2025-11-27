# Photo Upload & Deployment Workflow Ideas

You want a workflow where you (and only you) can upload images, which then triggers processing and deployment via GitHub Actions. Here are three ways to architect this:

## Option 1: The "GitHub UI" Method (Simplest)
You don't build a custom site. You simply use GitHub's web interface.
1. Go to your repo on GitHub.com.
2. Navigate to `photos/` folder.
3. Click "Add file" -> "Upload files".
4. Drag & drop your new photos and commit.
5. **GitHub Action** triggers, runs the python script, commits the results, and deploys.

## Option 2: The "Admin Dashboard" (What you asked for)
We build a simple web interface (like the one I showed, but different logic) that acts as a CMS.
1. **Frontend**: A page where you select photos.
2. **Logic**: Instead of saving to a server, it uses the **GitHub API** to commit these files directly to your repository's `photos/` folder.
3. **Security**: You would need to provide a GitHub Personal Access Token (PAT). Since this is just for you, you can run this locally or put it behind a simple password.
4. **Automation**: Once the files are committed by the dashboard, the GitHub Action kicks in.

## Option 3: The "Local CLI" Method
A simple command line tool.
1. You put photos in a local folder.
2. Run `npm run upload`.
3. It commits and pushes the photos.
4. GitHub Action handles the rest.

---

## The GitHub Action (The Core Engine)
Regardless of how you upload (Option 1, 2, or 3), you need a GitHub Action to handle the processing.

Here is how the Action would work:
1. **Trigger**: Watch for changes in the `photos/` directory.
2. **Process**:
   - Check out code.
   - Set up Python.
   - Run `process_photos.py`.
3. **Commit & Deploy**:
   - The script generates `public/data.json` and `public/photos/*.jpg`.
   - The Action commits these new files back to the repo.
   - Vercel (or your host) detects the new commit and redeploys the site.

### Draft Workflow File (`.github/workflows/process-photos.yml`)

```yaml
name: Process Photos
on:
  push:
    paths:
      - 'photos/**'

jobs:
  process:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
          
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install Pillow pillow-heif
          
      - name: Process Photos
        run: python scripts/process_photos.py
        
      - name: Commit and Push Changes
        run: |
          git config --global user.name 'GitHub Action'
          git config --global user.email 'action@github.com'
          git add public/photos public/data.json
          git commit -m "Auto-process photos" || exit 0
          git push
```
