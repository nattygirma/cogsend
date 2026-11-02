# Connecting accounts

**Accounts** lists every connected account and how to add another. **Connect new**
opens the platform picker.

## LinkedIn, Threads, Instagram, Facebook, YouTube, TikTok and X

These need a developer app of your own before they can connect, because the
platform issues the client id and secret the Worker uses. Until one is set up, the
picker shows the platform with a **Needs setup** badge, and choosing it shows that
platform's steps — the redirect URI to register and a form for the app's
credentials — instead of a connect attempt that cannot succeed. The full steps
are in [OAuth apps](oauth-apps.md).

Paste the credentials into that form and press **Save and connect**: nothing to
deploy and no checkout needed, which suits an instance installed with the
Deploy button. Worker secrets work too, set from a checkout or in the Cloudflare
dashboard; reload the page once they are on the Worker.

Instagram connects only a Business or Creator account; a personal account is refused with a note on switching its type in Instagram's settings.

Facebook connects Pages: every Page you grant while signing in becomes its own account, and a Page added later needs **Connect new** again. YouTube connects the channel of the Google account you sign in with; while the Google app is in Testing, it needs **Reconnect** every 7 days. TikTok posts only privately until its app passes TikTok's audit.

If you would rather not set up an app, you can connect these through
[Zernio](zernio.md) instead.

## Long posts on X

An X account connected directly shows whether it can post long: **Long posts on, up to 25,000 characters** or **Long posts off, 280 characters**, and where that came from. PostEasy asks X for the account's plan when you connect it and when you press **Check plan**, and any paid plan (Basic, Premium or Premium+) turns long posts on.

Some accounts that can post long, such as Verified Organizations, report no plan, so **Turn on** and **Turn off** let you decide. **Use what X reports** goes back to the plan. A reconnect keeps your choice. If X refuses a long post, PostEasy turns long posts off for that account; turn them back on if it does have a paid plan.

X accounts connected through [Zernio](zernio.md) stay at 280, since Zernio's X route stops there.

## When an account needs reconnecting

A token that stops working marks the account as needing a reconnect, both here and
in the composer's account list; **Reconnect** starts the same flow again and keeps
the account's history. The usual cause is LinkedIn: a self-created LinkedIn app
gets a 60-day token and nothing to renew it with, so it has to be reconnected every
60 days ([why](oauth-apps.md#linkedin)).

Posts already scheduled for the account still go out at their time, and the first one that succeeds clears the reconnect flag on its own; you can't publish, schedule, retry or reschedule anything new to it until then.

## Disconnecting

Disconnecting an account removes its scheduled posts, returns drafts that were
still waiting, and keeps what it already published — the confirmation says how many
of each. A disconnected account's history stays in [Insights](posts.md#insights),
marked **Archived**.
