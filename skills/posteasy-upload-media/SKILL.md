---
name: posteasy-upload-media
description: Attach a local video or image to a PostEasy post and schedule or publish it. Use when the user wants to post, schedule, or upload a file (mp4, jpg, png) with the PostEasy MCP, since MCP itself cannot carry files.
---

# Upload media to PostEasy

The PostEasy MCP has no upload tool, because MCP doesn't carry files. Upload the file to the REST API with the same key, and use the MCP tools for everything else.

Needs: `POSTEASY_API_KEY` (Settings → API access, a **Read + write** key) and the instance URL, e.g. `https://posteasy.appkeep.app`. If the shell doesn't see the key, it may only be set in an interactive profile: `export POSTEASY_API_KEY=$(zsh -ic 'print -r -- $POSTEASY_API_KEY')`.

## Steps

1. **Find the account.** Call `list_connections` and pick the `id` whose `handle` matches what the user named (for example `@nate.build` on Instagram).
2. **Create the draft.** Call `create_draft` with the caption as `baseBody` and keep the returned draft `id`.
3. **Upload the file** with one command.

   Video (MP4, up to 100 MB). The body is the raw file:

   ```sh
   curl -sS -T "/path/to/clip.mp4" \
     -H "Authorization: Bearer $POSTEASY_API_KEY" \
     "https://posteasy.appkeep.app/api/drafts/DRAFT_ID/media/video"
   ```

   Image (JPEG, PNG, WebP or GIF, up to 16 MB, 4 per card):

   ```sh
   curl -sS -H "Authorization: Bearer $POSTEASY_API_KEY" \
     -F "files=@/path/to/photo.jpg" -F "segmentIndex=0" \
     "https://posteasy.appkeep.app/api/drafts/DRAFT_ID/media"
   ```

   Success is HTTP 201 with `{"media": {...}}`. Quote paths that contain spaces.

4. **Schedule or publish.** Call `schedule_draft` with `draftId`, `connectionIds` and `runAt` as an ISO UTC time (get "now" from `date -u`, never guess it). Or call `publish_draft` to post now.
5. **Check the result.** Call `list_queue` after the time has passed: `published` means it went out, and `failed` carries the platform's error. Instagram and TikTok process video for a while after publishing, so give them a minute or two.

## Rules

- A video must be the only media on its card. Instagram and TikTok need a photo or video, and YouTube and TikTok need exactly one video.
- Upload only MP4 (H.264 + AAC works everywhere). The server doesn't convert files, so re-encode anything else with ffmpeg first.
- Don't use the form route (`-F files=@clip.mp4`) for video. It holds the whole file in memory and can fail on large files.
- Posting and scheduling go to real accounts, so confirm the account and the time with the user first.
