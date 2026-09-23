# IndexNow

Search engines that consume IndexNow — Bing, Yandex, Seznam, Naver, and through
Bing a chunk of what ChatGPT search surfaces — accept a ping saying "this URL
changed" instead of waiting to recrawl. **Google does not participate**, so
Search Console remains a manual job.

## How it is wired

- **Key:** `3e3bf9c898caa42b3cb08407a7711153`, served as
  `https://www.tradingsocial.io/3e3bf9c898caa42b3cb08407a7711153.txt`, whose
  only content is the key itself. Hosting that file at the root is what proves
  control of the domain; the key is public by design and grants nothing beyond
  the right to say a URL on this domain changed.
- **Ping:** the last step of `.github/workflows/publish-scheduled-posts.yml`. It
  runs only when that run actually published something, waits 90 seconds for the
  Vercel deploy, then POSTs the new post URLs to `api.indexnow.org`.
- **Failure is not fatal:** the step is `continue-on-error`. The post is already
  live and in the sitemap by then; a refused ping costs nothing but a day or two
  of discovery.

A 200 means accepted; 202 means accepted pending key validation, which is normal
on the first submission from a new key.

## Submitting something by hand

Any page on the domain, not only posts:

```bash
curl -sS -X POST 'https://api.indexnow.org/indexnow' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data '{
    "host": "www.tradingsocial.io",
    "key": "3e3bf9c898caa42b3cb08407a7711153",
    "keyLocation": "https://www.tradingsocial.io/3e3bf9c898caa42b3cb08407a7711153.txt",
    "urlList": ["https://www.tradingsocial.io/tools/consistency-rule-calculator"]
  }'
```

Submit URLs that changed, not the whole site: the protocol asks for changes, and
bulk-submitting unchanged pages is what gets a key ignored.

## If the key ever needs replacing

Generate a new one (`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`),
write it to `<key>.txt` at the repo root, update the key in the workflow and in
this file, and delete the old file. Nothing else depends on it.

## What this does not do

- It does not reach Google. Requesting indexing there is still a person in
  Search Console, and it is still the higher-value half.
- It does not guarantee indexing anywhere. It tells a crawler the URL is worth
  looking at; whether the page earns a place in the index is a separate
  question, and thin or duplicate pages are declined exactly as they always
  were.
