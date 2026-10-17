---
name: phone-copy
description: Make a throwaway copy of an app folder (default pos-lab) shown inside an iPhone 15/16 frame - real status bar, Dynamic Island, home bar, Apple's continuous screen corner - so the owner can try designs with no effect on the real app. Use when the owner asks to "turn it into a phone", "make a phone copy", or wants a safe copy to design in.
---

# Phone copy

1. Pick a new folder name next to the source, e.g. `pos-phone-2` (ask only if the owner gave none and the obvious one is taken).
2. Run: `py .claude/skills/phone-copy/make_phone.py pos-lab <new folder>`
   - Copies everything except `.png` screenshots and `img/` sub-folders (lab notes), then drops in `phone.html`.
   - If it prints "reaches outside the copy", fix those `../` paths inside the copy so it can't touch the original.
3. Add a server to `.claude/launch.json` on a free port:
   `{"name":"<new folder>","runtimeExecutable":"py","runtimeArgs":["-m","http.server","<port>","--bind","127.0.0.1","--directory","<new folder>"],"port":<port>}`
   and open `http://127.0.0.1:<port>/phone.html` (a `#page` hash opens that page, default `#items`).
4. Never edit the source folder. All design work happens in the copy.

## The frame (`phone.html`)
- iPhone 15/16: 393x852pt, 58pt status strip, 34pt home-bar strip passed to the app as `--ph-safe`.
- Every status-bar part was measured against the owner's iPhone screenshot to within 1pt; the corner is
  `border-radius: 88px; corner-shape: superellipse(1.8)` = Apple's 55pt continuous corner, 0.11pt off (Safari falls back to a 47px circle).
- Live clock; `?still` freezes it at 8:51 for measuring.
- Change the frame in `.claude/skills/phone-copy/phone.html` so every future copy gets it.
