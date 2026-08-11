# Social post media

Images and video for the automated poster
(`automation/n8n/content-queue.json`). Files dropped here are publicly served
after a deploy, at:

```
https://www.tradingsocial.io/assets/social/<filename>
```

Instagram and TikTok fetch the file from that address using their own servers,
which is why it has to be committed and deployed rather than sitting on someone's
laptop.

**Requirements**

| | |
|---|---|
| Images | **JPEG only** — Instagram rejects PNG. Aspect ratio 0.80–1.91. 1080×1080 or 1080×1350 are the safe sizes. Under 8 MB. |
| Video | MP4, vertical 9:16, keep it under 60s. |

Full instructions: `automation/n8n/CONTENT-GUIDE.md`.
