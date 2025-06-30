INSTRUCTIONS: Deploy your Knight Photo app on Netlify (GitHub or Netlify CLI)

1. Unzip this folder.
2. Get a free API key from https://imgbb.com/ for image upload. Paste it into netlify/functions/userapi-proxy.js at the line: const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY";
3. Upload this entire folder to GitHub.
4. Go to Netlify, create a new site from GitHub, and select your repo.
5. Netlify will install dependencies (busboy) automatically.
6. After deploy, visit your site. Upload a selfie or use your webcam and click Transform!
7. Wait ~30 seconds for your AI knight image to appear.

To update API credentials or prompts, just edit netlify/functions/userapi-proxy.js and redeploy.

Troubleshooting:
- If you see "Image upload to imgbb failed", check your API key.
- If Netlify says "Function error", try redeploying or double-check your credentials.
- To check if your functions are working, visit /hello-world (see hello-world.js).
