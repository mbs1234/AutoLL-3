# AutoLL-3 User Guide

AutoLL-3 books Walt Disney World Lightning Lane Multi Passes from the phone in
your pocket while you are in the park. You tell it which attractions you want,
in what order, and between which times; it watches Disney's tip board and takes
what appears — including in the two-second window when a scheduled drop lands.

This guide is in three parts: what to do **before the trip**, what to do **on
the park day**, and **what to do when something goes wrong**. A reference
section at the end collects the numbers.

Two things are true of the whole app and worth reading first:

- **It cannot get you more than Disney's rules allow.** Three Multi Pass
  selections at a time, one Tier 1 until somebody taps in, one booking per
  attraction per day. What it has over you is that it is faster and more
  attentive than you are at 7:00:02.
- **Keep Disney's own app as the source of truth.** AutoLL-3 is unofficial,
  experimental, and can stop working the day Disney changes an endpoint. When
  the two disagree about what you hold, Disney is right.

> **About the screenshots.** Every picture here comes from the preview harness
> (`npm run harness`), which runs the real screens against fake Disney clients.
> The data is invented: the party is Mickey, Minnie and Pluto, and the clock
> drifts a minute or two between shots, so times do not line up from one figure
> to the next. Where a screenshot shows text the running app would never
> produce, the caption says so.

---

# Part 1 — Before the trip

Do all of this at home, days or weeks ahead. The mistakes that cost you a
park morning get made weeks before it.

## 1. Install it

Open the [setup page](https://mbs1234.github.io/AutoLL-3/) **on the phone you
will actually carry in the park** — not on a laptop. The whole app is built for
a phone-width screen.

There are two ways in:

| | **Bookmarklet** | **Userscript** |
|---|---|---|
| What it is | A bookmark you tap | A script that injects itself |
| When it runs | Only when you tap it | Automatically on Disney's Lightning Lane pages |
| Needs | Nothing | A userscript manager (Userscripts on iOS, Tampermonkey on Android) |

Pick the userscript if you want AutoLL-3 to appear by itself; pick the
bookmarklet if you would rather decide each time.

**Install one userscript, not two.** AutoLL-3's autoloader and AutoLL v1.0's
both match `disneyworld.disney.go.com/vas/`, so with both installed they fight
over the page. Two *bookmarklets* are fine — each only runs when tapped.

**Nothing carries over from v1.0.** AutoLL-3 keeps its storage under `autoll3.*`
and never reads v1.0's keys. It starts completely empty: no party, no watch
list, not even the accepted warning. Your v1.0 data is untouched and stays
exactly where it is — but you rebuild here from scratch. Do it now, not at the
gate.

**Telling the two apart.** AutoLL-3 names its browser tab `AutoLL-3` and uses a
flask favicon (🧪) where v1.0 uses a bolt. The build name is also the last line
of the Settings menu.

## 2. First run

Run the bookmarklet on a page whose address begins `disneyworld.disney.go.com`.
On any other Disney page the tab is silently sent to AutoLL-3's start page
instead — if your tab suddenly becomes a GitHub Pages page, that is what
happened.

**The warning screen.** A red screen headed "Warning!" says the app is
experimental, unofficial and unwarranted. Tap **Accept** at the bottom. It never
appears again in that browser.

**Signing in.** AutoLL-3 never asks for your Disney password. It loads Disney's
own OneID sheet, which opens by itself, and Disney hands back a session token
that is held in your browser only. If the sheet does not appear, the card says
"Disney sign-in could not start. Check your connection and try again." and offers
**Sign in with Disney** again — after fifteen seconds when Disney's sign-in code
will not download, or thirty more when it downloads but Disney's setup does not
finish. That is the fix for the blank white screen v1.0 used to leave you on. A
slow setup carries on behind that button, so tapping it picks the setup up
rather than starting it over. If it is still stuck after two tries, the card
says so and offers **Reload the page**, which starts it afresh; tap your
bookmark again once the page has reloaded. If you close Disney's sheet on
purpose, it stays closed.

If it asks you to sign in again, a line under the heading says why:

| Line | What it means |
|---|---|
| "Your Disney session has expired." | The token ran out — or you tapped Log Out |
| "Your saved session ends before 5:00 PM park time. Sign in again before using Autopilot." | Still valid now, but it will die this afternoon |
| "Your saved session could not be read safely." | The stored record failed its shape check |

The five-o'clock refusal is the one worth acting on. Sign in again at breakfast;
it costs a minute then and saves you discovering a dead session at 2pm in a
queue.

## 3. Pick your party

![The settings menu](user-guide/settings.png)

Tap the **gear** at the right-hand end of the bottom tab bar → **Party
Selection**. Choose "Only book for selected guests" and tick the people you
actually want, then **Save**. After that, anyone outside your saved party is
shown on booking screens under Ineligible Guests marked `NOT IN PARTY`.

If someone you saved is no longer on the Disney account, Party Selection says
"1 saved guest is no longer on this account. Saving removes them from your
party." Tap **Save**. Until you do, **Whole party only** waits for a guest who
can never be booked, so Autopilot books nothing; Plan Check's **Check current
party** says "1 saved guest did not come back from Disney." for the same reason.

The same menu carries **Backup and Restore** (see *It cannot protect its own
storage*, below), **Log Out**, a **Session-only login** switch for a borrowed
phone (the token then lives only as long as the tab), a line saying whether you
are signed in and until when, a `Last backup:` line, and the build name.

> The Party Selection screen says the cap is 12 guests. At Walt Disney World it
> is actually 20 — the 12 is left over in shared code. In the harness screenshot
> above, **Not signed in** is simply because the harness never signs in; on your
> phone it will read, say, **Signed in until 6:42 PM**, or warn when the sign-in
> ends before park close.

## 4. Choose the park and the day

The header of the Today tab carries a **date** control and a **park** control.
Everything below them — the watch list, the plan, the timeline, the checks — is
scoped to that one park on that one day.

This is the single most important idea in the app. A plan you build for Tuesday
at Magic Kingdom is inert on Thursday at Epcot. That is deliberate: on Tuesday,
nothing Epcot-shaped can spend an action. But it also means a plan can look
empty simply because you are looking at the wrong day.

Autopilot follows those two controls too, on every tab. So while it runs with
something armed, switching park or day — or tapping **Modify** on a pass
for another park or day — asks first: "It is watching 3 armed at Magic Kingdom for today…"
**Stay** keeps it where it is; **Switch** points it at the new park or day, and
the plan left behind waits until you switch back.

The date picker offers 22 days as an upper bound. Most of those are not
bookable for most guests; requests for them simply fail.

## 5. Build the watch list — the Configure screen

![Configure](user-guide/configure.png)

Today tab → **Configure**. This is where the plan lives. Nothing here starts
anything: the screen is inert until you turn Autopilot on from Today.

### Adding an attraction

Scroll to **Lightning Lane attractions** at the bottom and tap the ☆ beside a
name. It moves up into **Watching (N)** and its card opens so you can set it up.
The **Filter attractions** box narrows both lists.

A newly added target starts with **every action off** — it only watches and
alerts. That is on purpose: alerting and booking are separate decisions.

### The five actions

![A target card unfolded](user-guide/configure-card.png)

Tap a card to unfold it. Five chips:

| Chip | What it does |
|---|---|
| **Auto-book** | Books it without asking, the moment a return time inside its window is offered |
| **Auto-move** | For a pass you already hold, moves it earlier when a better time appears — but only for a gain of **30 minutes or more**, and never later |
| **Book then move** | Takes the first time offered **even outside your window**, so you hold something, then works to move it in |
| **Swap in** | When all three slots are full, gives up your lowest-ranked held pass to take this one |
| **Pause** | Keeps it watched and alerting while nothing is booked or moved for it |

Things worth knowing:

- **Book then move ignores your window for the first booking.** If a bad return
  time is worse than none, do not arm it. Once something is held, the window
  governs the move again.
- **Swap in gives up the reservation the *app* ranks worst**, preferring a
  non-Tier-1 — not the one with the highest Plan rank you typed. The swap is a
  single request, so you can never end up holding neither.
- **Book then move and Swap in each imply booking**, so an attraction can be
  booked with Auto-book off.
- **Pausing keeps everything you armed.** The chips stay on, they just do not
  fire. Resuming brings the plan back exactly as it was.

There is a sixth chip, **Passkey**, on non-Tier-1 attractions only — see
[The passkey](#the-passkey) below.

### Return-time window

"Return between [time] and [time]". Leave either side blank for no bound.

A window **limits what Autopilot will take, not what it tells you about.** An
attraction outside its window still alerts, so a window can never hide the fact
that something came back.

> Clearing a bound to retype it does not take effect until you leave the field.
> That is deliberate: backspacing over `15:00` to type `14:00` used to hand
> Autopilot an unbounded window for as long as the field was empty — and during
> a drop burst the poller ticks about once a second.

### Plan rank

Your own priority order. Lower goes first when two attractions come back in the
same moment. Leave it blank to use the app's built-in ranking — which is the
same "Priority" sort the LL tab shows, so the engine always agrees with the list
you are looking at.

Rank also decides whether Autopilot passes on a Tier 1 offer to keep the slot
for a better-ranked Tier 1. It does **not** decide which reservation a swap
gives up.

### Stop watching

Inside the card, at the bottom. Removal is inside the card on purpose, so a
mis-tap on the list cannot lose a window and a rank. An **Undo** strip appears
for **8 seconds** after the last removal, with an Undo for each attraction
removed while it shows.

### The three safeguards

At the top of Configure, applying to everything:

| Chip | Default | What it does |
|---|---|---|
| **Dry run** | Off | Rehearsal. Every check runs and the log says what it *would* have done; nothing is booked |
| **Whole party only** | Off | Refuses to act unless everyone in your party is eligible |
| **Avoid clashes** | Off | Refuses a return time that lands on top of something you already hold, dining included |

All three safeguards start off. Each turns on only when you explicitly enable
it, and an existing installation keeps the value it already saved.

Booking by hand only *warns* about an overlap and lets you book anyway. Here it
skips instead, because there is nobody to warn.

### Colour means something

- **Blue** — an action that can spend an entitlement
- **Green** — a safeguard narrowing what may happen
- **Yellow** — rehearsal (dry run)
- **Amber** — paused
- **Red** — reserved for Stop, errors and blockers

Every chip also keeps "on" or "off" in its own text, so colour never carries the
state alone.

## 6. Check it — Plan Check

![Plan Check with blockers](user-guide/plan-check.png)

Today tab → **Plan check**. It reads the plan already on screen and returns
blockers first. **Opening it asks Disney for nothing** — it judges only the
configuration and data the app already has.

Blockers ("Fix before enabling:"):

- No saved targets apply to this park and date
- A target is not on the loaded tip board — usually a re-themed ride with a new
  internal ID
- An impossible return window — earliest after latest
- A window that falls **entirely** inside the protected time around a plan you
  already hold, so every time it allows would be refused

Reviews ("Review:"):

- Part of a window clashes with a held plan
- The tip board has not loaded
- Dry run is on
- Nothing is armed to act
- An armed attraction is paused
- More than one Tier 1 target armed to book
- Whole party only is off / Avoid clashes is off

Most items carry an **Open Configure** button. One about an attraction opens its
card, unfolded and in view; one about a setting opens Configure at its top, where
the three safeguards are. Items about the tip board carry
**Refresh LL list**, which is one of only two things on this screen that go to
the network. The other is **Check current party** at the bottom, which asks
Disney whether your saved guests are generally eligible — it cannot create an
offer and cannot spend an entitlement.

> A green "Ready" means the plan is internally *consistent*, not that a
> Lightning Lane exists. Eligibility, inventory and the offer's real return time
> are checked again immediately before every action.

> "Retired Ride" is the harness's fake data, not a real attraction. The harness
> also leaves Avoid clashes off, so a window inside lunch's protected time is
> not a blocker here; Plan Check says instead that clashes are allowed.

## 7. See it — the Timeline

![The day timeline](user-guide/timeline.png)

Today tab → **Timeline**. Your plans for the day down the left (Lightning Lanes
in blue, dining and other reservations in grey) and the windows Autopilot may
use down the right, both on one 4am-to-4am rail. A target with no window at all
is named above the rail under **Any time** rather than drawn: it permits
everything, and a bar the height of the rail only took room.

The pale band behind each plan is the **protected time** around it: 40 minutes
before it starts, and after it 60 minutes when the plan has no known end or 40
when it does. A window drawn over that band is a window Autopilot will mostly
refuse. A Multiple Experiences Pass gets no band, since it protects nothing.

Colours on the Targets column:

- **Green** — both bounds set, clear of every plan
- **Amber** — "crosses a held plan"; part of the window is still usable
- **Red** — "window fully blocked", or "bounds reversed"
- **Grey** — only one bound set, such as "from 3:00 PM"

Tap a bar, or a name under Any time, to open that plan, or that target's card in
Configure, unfolded and in view. A short bar answers a tap a little above and
below itself too.

Two limits worth knowing:

- **A half-set window is not checked against your plans.** Set only an earliest
  time (or only a latest) and the bar runs from that bound to the end (or from
  the start) of the day, grey and unflagged, even though Autopilot does enforce
  the bound you set.
- **A short bar keeps one line.** A plan an hour long is a short bar; on a
  narrow phone with two plans at once, its name is cut to a few letters. Tap it
  to open it.

## 8. The pre-trip checklist

![The pre-trip checklist](user-guide/pretrip-checklist.png)

When the day on screen is **not today**, the Today tab becomes a readiness list
of up to seven items:

- Party saved
- At least one target selected
- Attractions this build does not recognise, if Disney lists any. **Open** goes
  to Configure, which names them; it cannot be ticked, since only an update to
  the app recognises a ride
- An action actually armed
- Return windows confirmed, once there is a target
- Notifications allowed — or, where there are none, the alert sound tested
- Plan Check reviewed

Each item still to do has a button: **Open** goes to the screen that fixes it,
**Enable** asks the browser for notification permission, **Test** plays the
alert sound, and **Confirm** ticks the return windows. A finished item keeps a
button, so you can go back into it: **Review** opens its screen again, and
**Test** plays the sound again. Only allowed notifications have none, since
only the browser's own settings change them.

**Return windows** are yours to judge: no window is wrong in itself, and "any
time" is often the point. The line says how many targets have one, and the plan
further down Today shows each. **Confirm** once they are as you want them. The
tick is saved, and asks again when a window changes or a target comes or goes.

On an iPhone, Safari has no notifications, so the chime is the only alert. The
line then asks you to **test the alert sound**, and ticks only once you have
heard it.

It is a local readiness summary, not a live check of Disney — it makes no
requests. The panel disappears the moment the booking date is today.

> The "Plan Check reviewed" tick is saved, so a reload keeps it. It counts only
> for the park, day and plan you reviewed. Add, remove or change a target,
> switch a safeguard, or change anything else that alters what Plan Check
> finds, and the tick goes. Only the latest review is kept, so checking another
> park or day unticks the first.

## 9. The night before

- Re-check the **park and date** in the header.
- Run **Plan Check** and clear the blockers.
- Confirm **Dry run** is off if you want it to act — dry run survives reloads
  and a new park day, which is exactly why it is shown so loudly.
- Sign in again if the session line warns it ends before 5pm.

---

# Part 2 — On the park day

## 10. Starting up

Launch AutoLL-3 the way you installed it. You land on the tab you were last on —
usually **Today**.

**Autopilot always starts off.** The on/off state is deliberately not
remembered: a page reload leaves it off, and so does the 4am park-day rollover.
That asymmetry is what makes persisting per-attraction Auto-book safe.

## 11. Reading the Today tab

![Today, autopilot off](user-guide/today-off.png)

Top to bottom, Today answers the questions you actually ask in a queue.

**The freshness line.** "Plans and LL availability are current as of just now."
This is the line that tells you whether to believe the rest of the screen. If it
is climbing, tap the refresh button in the header. If there is **no line at
all**, neither list has ever loaded — that is not the same as fresh.

A refresh leaves the screen as it is, readable and tappable, with a thin bar
pulsing along the top edge until it is done. Only a first load, or a new park or
day, covers the screen with a spinner, since there is nothing to read yet.

**Held (N)** is what you are actually holding, at every park on that date.
**Plan (N)** is what Autopilot is still after, for the park in the header only.
The two lists are scoped differently on purpose, which is why you can see
"Held (2)" above "Nothing watched at Magic Kingdom on this date."

**The four buttons** — Configure, Plan check, Timeline, Activity — are the
screens Today deliberately does not try to be.

**Next Lightning Lane / Next drop** are the two times that decide when anything
can happen: when your next booking window opens, and the park's next scheduled
drop.

## 12. Turning Autopilot on

The big button in the middle. That one tap does four things: starts the loop,
unlocks the alert chime, asks the browser for notification permission, and asks
the phone to keep the screen awake. That is why it has to be a deliberate tap
and not a toggle in the header.

Turning it on starts a **fresh run**: the session log, skip counts, per-run
locks and the drop-detection baseline are all cleared, and anything already
available gets re-alerted. A refusal from Disney before the run does not stop
it; the next one does.

**Check the sound before you rely on it.** Under the notification notices
Today says whether the alert sound is armed, with a **Test sound** button next
to it. On iOS the chime is not one channel of three — notifications need the
page installed to your Home Screen, and vibration is unimplemented — so if the
sound is not armed during a run, nothing can reach you. While Autopilot is off,
Today presents this as a neutral pre-flight check rather than a fault. Tap
**Test sound** before starting, and again after any interruption if you want to
verify it manually. If you hear two notes, the channel works.

> **Autopilot only runs while the page is open and in front of you.** Lock the
> phone or switch apps and the browser throttles its timers to minutes. The
> screen wake lock exists to prevent exactly this, and it is best-effort.
> Today says **Screen is being kept awake** while it is held and warns
> **Screen may sleep** when the browser supports the lock but has not granted
> one. That row appears only while Autopilot is running, because an idle wake
> lock is expected when no checks are running: not while it is off, and not
> once it has stopped, since a stop gives the lock back on purpose.

### Put the running phone in your pocket

Once Autopilot is running, tap **Pocket it**. (A stopped run does not offer
it: nothing is running to guard.) The full-screen guard leaves the
poller and notifications running while preventing the live glass from reaching
the controls underneath it. It also blocks page scrolling and pull-to-refresh;
a reload would turn Autopilot off.

To lift the guard, tap the moving circle three times. The three clean taps must
land within **10 seconds**. A miss, second finger, drag or cancelled gesture
clears all progress, and the target moves after each accepted tap.

If the phone reports your fingertip as unusually large, keep using one finger
and follow the moving circle. Three large-contact taps within **20 seconds**
lift the guard through its escape path. It allows a little more movement, still
resets on a miss or second contact, and remembers your phone until the page is
reloaded so re-pocketing does not make you repeat a separate setup.

The guarded screen is also a status display. It shows the current checking
pace, the number of targets that can actually act, today's booking count, and a
line such as **Sound on · Screen held**. A red **No sound** or **Screen may
sleep** means to lift the guard and check the named channel; the status follows
the browser directly rather than waiting for the next poll. If Autopilot stops
or the 4am rollover turns it off, the guard changes to a red warning. Lift it
and deliberately start a new run; an off or stopped guard is not still
checking. A NextLL search has its own **Pocket it**, and its guard shows that
search instead (section 19).

### Lock the phone to Safari with Guided Access

Pocket mode guards the page. It cannot guard Safari's own toolbar, because no
web page can cover or disable browser chrome — and the **back** button is the
one that really hurts, because it navigates away and destroys the run. iOS
**Guided Access** is what stops a pocket reaching it.

**Set it up once.** Settings → Accessibility → **Guided Access**, turn it on,
then:

- **Passcode Settings** — set a passcode and turn on **Face ID**, so ending a
  session is a triple-click and a glance rather than typing in bright sun.
- **Display Auto-Lock** — set it generously (**Never**, or the longest
  offered). This is separate from the app's screen wake lock, and you do not
  want the two arguing.

**Each time you pocket the phone.** Start Autopilot, tap **Pocket it**, then
triple-click the side button (double-click on iOS 18 and earlier). On the
Guided Access screen, circle the areas to disable with your finger, then tap
**Start**. iOS remembers the regions per app, so you draw them once.

**What to circle:**

- **The bottom strip** — on Safari's default layout this holds the address bar,
  back, forward, share, bookmarks and tabs.
- **The top strip** — the status bar and the notch. Check which Safari layout
  you use first: if you moved the address bar to the top, this matters as much
  as the bottom.

Leave the middle alone. That is where AutoLL-3 is.

**Two ways to run it.** Circle the strips and leave touch on, and Pocket mode
still works normally — three taps lift the guard and you can check on things
without ending the session. Or open **Session Settings** and turn **Touch**
off, and nothing on the glass responds at all; you can still read the guarded
screen, and you triple-click to end Guided Access when you want to interact.
The first is more convenient, the second is airtight. They are alternatives,
not layers: with Touch off, the three-tap unlock cannot work either.

**To end it,** triple-click the side button, authenticate, then **End**.

> **Crash Detection and emergency calls do not work during a Guided Access
> session.** Apple states this outright. End the session rather than leaving it
> running all day out of habit.

## 13. What the status words mean

![Today while bursting at a drop](user-guide/today-running.png)

| Status | Pace | When |
|---|---|---|
| **Off** | — | Not running |
| **Watching** | ~45 s | Nothing near |
| **Checking often** | ~6 s | 5 to 2 minutes before a target, or inside a refill window |
| **Checking rapidly** | ~1.2 s | From 2 minutes before a target to 2 minutes after |
| **Waiting: Disney asked to slow down** | — | Disney answered a check with a 429. Still on and armed; it carries on by itself at the time shown ([below](#disney-asked-to-slow-down)) |
| **Stopped after repeated errors** | — | Eight checks failed in a row |
| **Stopped: Disney refused a request** | — | Disney answered with a 403, and everything stopped ([below](#disney-refused-a-request-and-everything-stopped)) |

Beside it, `(57 checks)` counts the checks since you turned it on — **the
simplest proof it is alive is that number rising between visits.**
`Local timing: last cycle 412 ms, average 498 ms` is how long a check is taking
on your connection; a sudden jump means slow wifi, not a bug.

The bold coloured line above the status is **history** — the last thing
Autopilot actually did, with a time. It survives switching Autopilot off,
because the day's log is saved. Only the Status block is live.

> Two things labelled "Next drop" on this screen are not the same. Inside the
> Status block it is whatever moment the poller is chasing — which can be a
> booking window or a drop the app has learned by observation. Lower down it is
> the built-in table only. In the screenshot they read 10:33 AM and 11:47 AM;
> that is not a bug.

**How to tell it is working.** Freshness line recent → button red → Status not
"Off" or "Stopped" → check counter rising. If all four look healthy and nothing
is booking, look for the amber "failed checks in a row" line, then the yellow
dry-run banner, then the "n armed" count in Plan. A running Autopilot with **0
armed** will never book anything. **Waiting** in amber is not a fault: Disney
asked it to slow down, and it carries on by itself (Part 3).

### Dry run

![Dry run armed](user-guide/dry-run.png)

"Dry run is on. Autopilot will watch, alert, and run every check, and the
activity log will show what it *would* have booked, moved, or swapped — but
nothing will actually be booked."

Rehearsal runs the same pre-offer guards as the live path. The one thing it
cannot test is the real time Disney would have offered, because getting that
costs a real request. Turn it off in Configure.

## 14. Around a drop

You do not have to do anything. Autopilot carries a table of the minutes Disney
tends to release extra inventory, per park, and bursts at all of them:

| Park | Attraction | Drop times |
|---|---|---|
| Magic Kingdom | Tiana's Bayou Adventure | 09:47, 11:47, 13:47, 14:17, 15:47, 17:47, 19:47, 21:47 |
| EPCOT | Test Track | 08:47, 12:47, 14:47, 17:47 |
| Hollywood Studios | Millennium Falcon | 10:47, 15:47 |
| Hollywood Studios | Slinky Dog Dash, Toy Story Mania, Tower of Terror | 13:17, 15:47 |
| Animal Kingdom | Expedition Everest | 08:47, 12:47, 14:47, 15:47 |
| Animal Kingdom | Kilimanjaro Safaris | 09:47, 12:47 |
| Animal Kingdom | Kali River Rapids | 13:47 |

**The burst is park-wide.** If any attraction in the park drops at 13:47,
Autopilot bursts at 13:47 even if you are not watching that ride. It starts two
minutes early because Disney releases drop inventory early often enough that
arriving at the advertised minute is arriving late.

**Refill windows** are different. Nine attractions trickle inventory back over
hours rather than dropping at an instant, and for those Autopilot holds the
6-second pace for the whole span — **but only if that attraction is on your
watch list**, unlike drops:

- **09:00–10:30** — Test Track, Slinky Dog Dash, Toy Story Mania, Tower of
  Terror, Na'vi River Journey
- **11:00–14:30** — Jingle Cruise, Jungle Cruise, Peter Pan's Flight, Mickey &
  Minnie's Runaway Railway

Outside those nine drop minutes, a return time appearing is somebody
cancelling — and forty-five seconds is how you miss it.

### The Tier 1 hold

Disney lets a party hold one Tier 1 selection at a time until the party's first
redemption of the day. This guide calls that Disney's **Tier 1 limit**, and
Autopilot's answer to it the **Tier 1 hold**.

While the limit applies, Autopilot will **decline a Tier 1 it could take** if a
Tier 1 you ranked higher has a drop coming within **90 minutes**. Past that
horizon the hold releases on its own, and after the party's first tap-in of the
day there is no slot left to keep, so it stops.

It shows up in Activity as "held the Tier 1 slot for a better attraction". To
take the lower-ranked ride now, **pause the one it is waiting for**, the Tier 1
you ranked higher: the hold then releases. Pausing the lower-ranked ride only
stops it being booked at all.

### The passkey

Mark one easy, high-availability, **non-Tier-1** attraction as the day's
passkey, in its Configure card. Autopilot books it first; once Disney's own
tracker says that entitlement is spent, it asks the eligibility endpoint whether
the Tier 1 limit has actually lifted for everyone in your party.

**Tap in at the passkey's Lightning Lane entrance with everyone in the party**:
the party's first redemption of the day is what lifts the Tier 1 limit. While it
waits, Today's **Passkey** line names the ride to tap in at. Once Disney
confirms, Autopilot raises a "Tier 1 limit lifted" alert, and its Tier 1 hold
stops for the day.

> Booking the passkey does nothing. The limit lifts only when the pass is
> actually *spent* — and Disney counts a window you let lapse the same as one
> you rode, so Autopilot cannot tell those apart.

## 15. The LL tab — the tip board

![The tip board](user-guide/tipboard.png)

One row per attraction: a ☆ favourite, the name, a tier badge, the current
**STANDBY** wait, and an **LL** button showing the next return time. Tap that
button to start booking.

The banner under the header reads `BOOK:` and `DROP:` — the next moment you may
book, and the park's next drop.

**Sorting.** The second header control offers Priority (the app's own ranking),
Nearby (closest first, today only), Standby, Soonest, and A to Z. Whatever you
choose, attractions with no availability sink to the bottom, and sorting never
crosses a tier boundary.

**Symbols.** ⚡ is a Lightning Pick — a long standby wait paired with a soon
return time. ⬇ means an upcoming drop (solid = the next one, faded = a later
one). ✓ means you already hold a pass. A **green bar** down the left edge means
this attraction is available earlier than a pass you already hold in that
tier — the one cue with no legend entry.

The clock button between the park picker and refresh is the **Autopilot status
light**: green running, yellow dry run, red stopped, plain off, with the number
of attractions being watched. Tapping it opens Today; it is navigation only, so
a mis-tap can never change what gets booked.

> Sold-out attractions still appear, reading "none". A ride Disney has re-themed
> under a new internal ID vanishes from this list silently — the warning for that
> is on Today.

## 16. Booking by hand

![The booking screen](user-guide/book-by-hand.png)

Tap any LL time on the tip board. You get the attraction, its land and park, a
box listing the passes you already hold that day, the offered window as
**Arrive by: 10:54 AM – 11:54 AM** with a **Change** button, and **Your Party**
with a **Modify** button. The button at the bottom commits.

- **Change** opens a grid of return times by hour. Tick **Show all** to see
  ten-minute slots across the whole day — those are the app's educated guesses,
  not Disney's real inventory, and picking one that does not exist gets you the
  nearest one that does.
- **Modify** trims the party. Adding someone who was not previously selected
  fetches a fresh offer, so the return time can change; removing guests leaves
  the offer alone.

If the offer goes stale between loading and tapping Book, you get a red "Offer
expired — refreshing…" flash and a new offer is fetched — **check the new time
before tapping Book again.**

Three dead ends you may land on instead: **No Guests Found** (a network blip —
Try Again), **No Eligible Guests** (often with an "Eligible at 11:56 AM" note),
and **No Reservations Available** (not enough slots for the whole party — trim
it and check again).

## 17. The Plans tab

![Your Plans](user-guide/plans.png)

Your whole itinerary as the app last read it: Lightning Lanes, DAS selections,
dining, boarding groups, grouped by park day. Tap any row for details.

Only **Multi Pass Lightning Lanes** can be changed here. Dining, park passes,
boarding groups and Multiple Experiences passes are read-only however they look.

On a Multi Pass's details screen:

- **Change** — a different return time for the same attraction
- **Modify** — hand the pass back to the booking flow to trade it for a
  different attraction, keeping it held until the replacement is booked
- **Cancel** — remove chosen guests, or the whole reservation when you remove
  everyone

> **Cancelling has no "are you sure" step.** If Disney refuses the cancel, the
> screen stays where it is with the error, and the party is unchanged. If Disney
> does not answer at all, it says so — the cancel may or may not have gone
> through — and points to Plans. Booking and modifying by hand do the same: a
> request with no answer is never shown as a plain failure beside a live button,
> and the reservation is protected until Plans show what happened (see *A change
> that never came back*).

> **"Nothing was sent"** means what it says. "Another AutoLL action is changing
> this reservation right now" is Autopilot or a time search part-way through a
> change to it, and passes within two minutes; "this reservation has an
> unresolved change" is a protection, shown below the message, that Plans or you
> settle.

> Plans mirrors Disney; it is not live. A pass cancelled on another phone will
> not disappear until you refresh.

> **"Disney's Plans could not all be read"** means a pass in Disney's answer
> could not be read, or the answer came without its list. Something may be
> missing from the tab, so check Disney's app before relying on it. A read like
> that releases nothing that is held: a pass missing from it may only be
> unreadable.

## 18. The Times tab

![The Times guide](user-guide/times.png)

A read-only park guide: standby waits, show and character times, and Individual
Lightning Lane prices, grouped by land. Names in bold and in the land's colour
are the ones the data file flags as popular.

Symbols: `–` no posted wait, `❌` standby not open, `VQ` virtual queue only.
The tab's own legend calls `❌` "Temporarily down", which is one reason, not
the only one: a ride with an Individual Lightning Lane on sale shows `❌`
whenever its standby is not open.

This tab is also the **only** way to request a DAS return time: a **DAS** button
appears in the header if Disney reports at least one registered party on your
account. (An existing DAS selection also opens from Plans and the Timeline.)

> The harness cannot show show-times, DAS or ILL prices — its fake clients
> return nothing for those — so the screenshot above is waits only.

## 19. The NextLL tab

![NextLL](user-guide/nextll.png)

NextLL is the "I want *this* ride, now" engine — one attraction, one optional
window, one button, and you stand there watching. It is a second booking engine
running inside the app's own, deliberately kept apart from Autopilot: its own
watch list, its own storage, its own poller. A quick search can never add to,
arm, or switch off your day plan.

**Book a new Lightning Lane** picks one attraction and takes the first time it
can get, then keeps trying to move it earlier — checking about every 0.6
seconds.

Two traps worth knowing:

- **"Return by 1pm" does not mean it will only book before 1pm.** With nothing
  held the window is stripped and it takes whatever is offered — even 7pm — and
  only then starts moving it toward your window.
- **"Return after" is the opposite trap.** Setting a lower bound turns the
  window into a filter on the *booking*, so the search can spend the morning
  refusing everything earlier than your bound and holding nothing at all. For a
  later return use Time Search instead.

**Leaving the tab stops the search.** It is remembered: come back, tap "Book a
new Lightning Lane" again, and a card offers to resume. Today also shows a
reminder card with an "Open NextLL" button.

**With a time set, it stops itself when it succeeds.** Once the pass it holds
is inside your "Return after" or "Return by" window it says "that will do",
stops checking, and waits for you to tap **Done**. **With no time set, it keeps
going:** it books the first time it can, then keeps moving the pass earlier
until you tap Done, or until the ten minutes below run out.

**Pocket it works here too.** While the search runs, **Pocket it** under **Stop
looking** puts up the same guard as Today's, lifted the same way. The guarded
screen shows this search rather than your day plan: the ride, what it holds,
the window it is aiming at and the number of checks. It reads **Done** once the
search has what you asked for, and turns red if it stops for any other reason.

**It stops after ten minutes with nothing booked or moved**, and says to take a
break: long searches can make Disney pause your account. The ten minutes count
from the last booking or move. Starting again is allowed. It also stops, and
says why, if Disney refuses a request or asks it to slow down (Part 3).

**Modify a held Lightning Lane** lists the passes you hold and leads to the two
search screens below.

**When two people hold the same ride.** If more than one person holds the
attraction at different times, NextLL works on the reservation your **saved
party** holds. With no party saved, or a party that includes both, it cannot tell
which you mean, so it says so and lists who holds what: save a party of only the
people whose reservation should move — the gear, then **Party Selection** — and
start again. Autopilot follows the same rule, and Plan Check warns about it
ahead of time.

## 20. Time Search

![A search in progress](user-guide/time-search.png)

NextLL → Modify a held Lightning Lane → pick one → **Improve return time**. Also
reachable from a held pass: Plans → the row → **Change** → "Search for a better
time". It works on the pass you opened it from, even when someone else in your
party holds the same ride at another time.

This is the one screen that can do what Autopilot structurally cannot. Autopilot
sees only the single earliest time the tip board advertises, so it can only pull
a pass **earlier**. Time Search opens a real modify offer and reads the
**return-time grid** behind it, so it can walk a pass in either direction toward
a time you type in — including **later on purpose**, for a dinner reservation.

**The grid is Disney's list, and it leaves times out.** It omits any time that
would overlap another of your plans, though Disney books such a time when asked
for it by name — which is how the manual screen's **Show all** reaches it. So
Time Search asks by name as well: for the tip board's earliest when finding the
earliest, and for your time when aiming. With **Avoid clashes** on, it skips any
time that overlaps another plan, exactly as Autopilot does; off, the default, it
takes an overlapping time the same way Show all lets you.

- **Find the earliest** chases the soonest slot.
- **Or aim for** + **Aim for this time** walks toward a named time, accepting
  gains as small as five minutes, and stops with "That will do — the reservation
  is at the time you asked for."

![Searching, one move already made](user-guide/time-search-running.png)

**A later move is offered, never taken.** When the best move toward your target
is a later slot, an amber box appears: "A later time is available: … Taking it
gives up the earlier reservation you hold now." with a **Take it** button.
Nothing is held for you while it waits — the slot can be gone by the time you
tap. The move is made on the next cycle, up to six seconds later, and the screen
says "Moving to …" from the moment you tap.

Both searches take an exclusive, expiring lock on that one reservation from
their first attempted change, so Autopilot cannot touch it mid-search. If
Autopilot got there first you get an amber "Waiting for Autopilot to finish a
request…" box, and the search takes over as soon as that returns.

**Change attraction** is the sister screen: it hunts a replacement ride for a
pass you hold. **Choose up to three attractions and it takes whichever opens
first**: once one is chosen, an "Or" choice appears for another. Each check reads
the tip board once, and asks Disney for an offer only for a chosen ride that is
open, the soonest-opening if several are. So three rides cost no more requests
than one, and none are asked for while nothing is open.

It **always asks before replacing**, naming the ride that came up, even if the
offered time is earlier. Once you tap **Replace Lightning Lane** it says it is
replacing, then that it is waiting for Plans, and finally **Replaced …
Confirmed in Plans.**

**Both stop after 200 checks with nothing to take**, about twenty minutes, and
say to take a break. A check where Disney has no offer at all, as for a sold-out
ride, counts. Starting again is allowed. Both also stop at the first
refusal from Disney, or when Disney asks them to slow down (Part 3).

## 21. The Activity screen

![Activity](user-guide/activity.png)

Today tab → **Activity**. At the top, when anything is held, the protection
panel (see *A change that never came back*). Then up to four sections:

**Protection settled today (N)** — every hold that ended today, newest first,
and how: *confirmed by Disney's Plans*, *Disney answered* (its late answer came
back after all), or *cleared by you*. It appears once something has settled.

**Booking activity (N)** — today's bookings, moves, swaps, rehearsals and
failures, newest first, capped at 20 rows. Repeated failures collapse to one row
with a `×47` count instead of flooding the log.

**Why nothing was booked** — a tally of every reason Autopilot decided not to
act, in plain English: "the offered time was outside the window", "not everyone
in the party was eligible", "held the Tier 1 slot for a better attraction", "it
clashed with something already booked", and a dozen more. **This is the answer
to "it's running, so why hasn't it booked anything?"** — skips are the normal
outcome and are kept out of the log so they cannot swamp it.

**Learned drop times** — what Autopilot has seen with its own eyes, against the
built-in schedule. A drop seen on **two different park days** becomes eligible
to join the times it bursts for. A red "never seen in 3 watched days" is
evidence for you, not an action it took: removing a built-in time is switched
off in this build.

> The log and the skip counts both survive a reload. Turning Autopilot on
> starts the counts over, and at 4am both reset and Autopilot switches itself
> off.

> In the screenshot above, "forty minutes sooner, inside the window" and
> "Network request failed (403 offer)" are harness fixture text. The running app
> writes one of three fixed justifications, and its failure rows read
> "Request failed (403)".

---

# Part 3 — When something goes wrong

## The one diagnostic

**Book a single Lightning Lane by hand and read the banner at the bottom of the
screen.** Everything else in this section is a variation on that one test.

| Banner | Meaning | What to do |
|---|---|---|
| `Network request failed (403 guests)` | Disney's filter is refusing this app | Book in Disney's app. When Autopilot or a search meets one, AutoLL-3 stops everything itself (below) |
| `Network request failed (no response guests)` | Your signal dropped — an 8-second timeout | Move, or switch wifi off. **If you were mid-booking, check Disney's Plans first** |
| `Too many requests just now.` | You tapped faster than 5 requests/second | Wait five seconds |
| `Unknown error occurred` | No status at all — usually the rate limit, on screens that do not name it | Wait five seconds and retry once |

The banner clears itself after three seconds and is stored nowhere. Miss it and
the only way to see it again is to repeat the action.

## Disney refused a request, and everything stopped

![Stopped: Disney refused a request](user-guide/refused.png)

A **403** is Disney's filter refusing this app, and it usually lands on the
eligibility call, one step before an offer exists. The first one stops
**everything**: Autopilot, and any NextLL, Time Search or Change attraction
search. Today reads **Stopped: Disney refused a request**, and Autopilot raises
its "has stopped" alert. It stops at the first because knocking again is what
keeps an account paused.

You may start again whenever you like: Autopilot with **Restart autopilot**,
under the stopped line and its warning, and a search by starting it again. For half an hour a note under the switch, and
beside each search's start button, says when Disney refused and warns that
**the next refusal stops everything again**. There is no grace period. Book by
hand in Disney's app meanwhile.

## Disney asked to slow down

A **429** is Disney asking this app to slow down. What happens depends on who
it asked:

- **Autopilot waits.** It raises an alert saying when it will check again, and
  stays on and armed while it sits out the wait. The wait is Disney's own
  suggested time when it sends one; otherwise 2 minutes, doubling with each
  429 in a row, to 30. Today, the footer strip and the pocket screen say
  **Waiting: Disney asked to slow down**, and until when. It carries on by
  itself.
- **A search stops**, whether NextLL, Time Search or Change attraction, and
  says why. You may start it again early. The note beside its start button
  says when Disney asked, and until when it suggested waiting.

## Autopilot stopped

![Stopped after repeated errors](user-guide/stopped.png)

Eight checks failed in a row, so it gave up rather than spin. (A refusal from
Disney stops it too, and says so; see above.) It is no longer watching,
alerting or booking, and **it does not restart itself.**

**Restart autopilot**, under the stopped line, starts it again in one tap. It
used to take two, off then on. (A stop caused by an expired session is
different: signing back in remounts the app with Autopilot off, so there
**Turn on autopilot** starts it.)

When it gives up it raises one alert, "AutoLL-3 has stopped", on every channel
it can. On an iPhone in Safari that is the sound alone: there is no
notification to carry the words and no vibration, so what reaches you is one
two-note chime, the same as every other alert. Nothing in it says the run has
ended, so look whenever you hear it — and if the sound is not armed, nothing
reaches you at all. An expired session raises no alert on any phone: the app
just goes back to asking you to sign in.

You also find out by looking at Today, by the footer strip on other tabs, or by
noticing the header clock has turned red — or by your phone starting to sleep
normally again, because the wake lock is released.

> The screenshot says "5 failed checks" because that is a hand-set harness
> fixture. The real app always stops at **8**.

## An attraction has vanished from the list

![An unrecognised attraction](user-guide/unknown-attraction.png)

"Disney is listing 1 attraction this build does not recognise. Configure names
it." Disney has re-themed a ride and issued a new internal ID; the old one stops
appearing, and the new one is dropped silently — no row, no target, no alert.

Open **Configure** for the ID numbers. There is no fix inside the app. Check
your saved plan too: the target sits there looking armed, and Configure lists it
under "Not on today's list" with a remove button.

## A change that never came back

![A move whose outcome is unknown](user-guide/time-search-unresolved.png)

A booking request can leave the phone and never return: the park's wifi drops,
the response never arrives, or what arrives cannot be read. It may have worked
or it may not, and nothing arriving later can tell you which. Retrying risks
booking or moving twice; forgetting it leaves a pass unprotected.

So that reservation is **held**, and the hold is visible. Activity and Plan
Check both list it under a red panel, naming the attraction and what the change
was trying to do — "Move Haunted Mansion from 7:15 PM to 11:40 AM on March
5" — and Today says so in a banner. The same goes for a booking, a change or a
cancel you made by hand, and for Autopilot's own bookings: when one gets no
answer, the phone alerts you with *No answer from Disney*. Booking, moving,
swapping and cancelling that attraction are paused, by Autopilot and by hand,
until it is settled.

Most holds settle themselves from Plans:

- **A booking** clears when Plans show any of its guests holding the
  attraction: it went through. Plans still showing nothing do not prove it did
  not, because Disney can apply a request late. Once a complete read of Plans,
  thirty seconds or more after the request, still shows nothing, the panel says
  so beside the button: *No booking was visible in the last complete Plans
  check. The original request may still complete. Clearing permits another
  attempt.* One tap on **Clear this protection** releases it. Clearing one of
  Autopilot's lets it try the attraction once more.
- **A cancel** clears when Plans no longer show the passes it was for. While
  they are still there it waits for you, however long: the cancel may not have
  happened, or it may yet land on whatever the pass has become by then.
- **A move or a swap** clears only when Plans show the exact requested time.
  Plans that still show the old time cannot tell a move that failed from one
  Disney has not shown yet.

A read of Plans that could not see everything settles nothing it might have
missed. If a pass could not be read, or Disney's answer came without its list,
a hold on that attraction, on any day the pass may be, waits for a complete
read.

**Open Disney's Plans and look.** Then, if you want to release it yourself:
**I checked Disney — resolve this** → **Clear this protection**. It asks twice
because clearing it is the one action here that can cost you a reservation. A
booking Plans have not shown takes one tap instead.

**Clearing is a judgment, not proof.** Disney can still apply a lost request
after you clear it. A booking can then turn up as an extra pass, for example
after the attraction was booked again and that booking given up, and a cancel
can remove whatever the pass has become. If Plans show something you did not
expect, that is the likely reason.

## Common questions

**"Why is nothing booking?"** In order: is Dry run on (yellow banner)? Is
anything armed (`n armed` in Plan, not paused)? Did it stop, or is it waiting
because Disney asked it to slow down? Then read **Why nothing was booked** on
Activity.

**"Why did it skip a time I wanted?"** Most likely the offered time fell outside
that attraction's window, or Avoid clashes refused it against a plan you already
hold — including dining, which the Timeline does not draw.

**"It booked something at a terrible time."** Check whether **Book then move**
is armed for it. That action ignores your window for the first booking by
design.

**"It gave away the wrong pass in a swap."** Swap in gives up the reservation
the *app* ranks worst, not the one with the highest Plan rank you typed.

## What it cannot do

**Walt Disney World Lightning Lane Multi Pass only.** Disneyland and virtual
queues were removed. AutoLL v1.0 still carries both; if you need to join a
boarding group, use Disney's app. A boarding group already in your itinerary
still displays here.

**Individual Lightning Lane is not booked.** Only Multi Pass.

**It cannot protect its own storage.** Everything AutoLL-3 keeps — your party,
your watch list, and what it has learned about drops — is stored by Safari for
Disney's website. Safari deletes a website's stored data after about a week of
Safari use without a visit to that site, and nothing warns you when it does.
**Back it up:** the gear at the bottom right, then **Backup and Restore**, then
**Back up now**. It saves one file — your plan, your party and every drop the
learner has seen — to Files, or AirDrops it to a computer. Your Disney sign-in
is never in it. The same menu says how long it has been since the last one.
**To put it back** — on a new phone, or after Safari has emptied this one — turn
Autopilot off, open **Backup and Restore**, then **Choose a backup file**. It
shows what the file holds before it changes anything, and **Replace this phone’s
plan** swaps in the file’s watch lists, party and starred attractions and adds
the file’s drops to what the phone has seen. Your sign-in and settings, dry run
included, stay as they are. Reload the page afterwards. If a restore fails
part-way and the phone's own plan cannot be put back either, a red notice says
"The original plan isn’t fully back". Keep the page open, tap **Export original
plan** first, then **Retry recovering original plan**, and reload when it says
it has recovered.
**Between trips, open AutoLL-3 at least once a week** as well, or it may start
empty next time.

**Rough edges, as of 1.9.1.** None known beyond what
[docs/FUTURE.md](FUTURE.md) lists, with what each would cost to fix.

---

# Reference

## Checking speeds

| Mode | Interval | Trigger |
|---|---|---|
| Idle ("Watching") | 45 s | Nothing near |
| Approach ("Checking often") | 6 s | 5→2 min before a target, or inside a refill window |
| Burst ("Checking rapidly") | 1.2 s | T−2:00 to T+2:00 around a target |
| Tomorrow | 15 s | Booking date is tomorrow, 7am–10pm park time |
| NextLL quick search | 0.6 s | A hand-started book search |
| Time Search | 6 s | A hand-started time search |

Every interval is spread ±20% so the pattern is not perfectly regular. A date
further out than tomorrow gets no drop times at all and sits at 45 s.

## Limits and thresholds

| | |
|---|---|
| Requests | 5 per second per client, then a 5-second cooldown |
| Single check deadline | 90 seconds, then abandoned and counted as a failure |
| Backoff after a failure | 2 s doubling to a 60 s cap |
| Gives up after | 8 consecutive failures |
| Stops everything at | The first 403 from Disney: Autopilot and every search |
| Autopilot's wait after a 429 | Disney's suggested time; otherwise 2 min, doubling with each 429 in a row, to 30 |
| NextLL session | 10 minutes with nothing booked or moved |
| NextLL with a time set | Stops once the pass it holds is inside that window |
| Time Search and Change attraction | 200 checks with nothing to take, about 20 minutes; a check with no offer at all counts |
| Change attraction | Up to 3 attractions, whichever opens first |
| Warning beside start buttons | 30 minutes after Disney last pushed back |
| Auto-move minimum gain | 30 minutes (1 minute for a NextLL target with a bound) |
| Time Search minimum gain | 5 minutes |
| Tier 1 hold horizon | 90 minutes |
| Protected span around a plan | 40 min before; 60 after with no end time, 40 with one; 20 before a show ends |
| Undo after Stop watching | 8 seconds after the last removal, one Undo for each |
| Activity log | 20 rows |
| Drop learning | 2 distinct park days before a time is used |
| Party cap | 20 guests |

## What resets when

| Event | Effect |
|---|---|
| Turning Autopilot on, or Restart autopilot | Clears session log, skip counts, locks, cache, passkey status, drop baseline; re-alerts anything available. A refusal before it does not stop the new run; the next one does |
| Turning Autopilot off | Leaves skip counts and the log alone |
| Page reload | Autopilot off; skip counts, log and watch list survive |
| 4am park-day rollover | Autopilot off; screen wake lock released; log emptied; skip counts zeroed |

## Glossary

**Multi Pass** — the Lightning Lane product this app books. Three at a time.

**Tier 1** — Disney's headliner group. One at a time until the party's first
redemption.

**Tier 1 limit** — Disney's rule that a party holds one Tier 1 selection at a
time until its first redemption of the day.

**Tier 1 hold** — Autopilot passing on a lower-ranked Tier 1 to keep that one
slot for a better one with a drop due soon.

**Drop** — a scheduled release of extra inventory at a fixed minute.

**Refill window** — a span of hours over which an attraction trickles inventory
back, instead of dropping at an instant.

**Passkey** — an easy non-Tier-1 ride you mark to be booked and ridden first, to
lift the Tier 1 limit.

**Rank** — your own priority number for a target. Lower goes first. Blank falls
back to the built-in ranking.

**Protected time** — the span around a plan you hold that Autopilot treats as
spoken for.

**Dry run** — rehearsal: every check runs, nothing is booked.

**Quarantine / protection** — a hold placed on a reservation whose change got no
definite answer from Disney.

---

## Related documents

- [README.md](../README.md) — what this build is, and how to install it
- [ROADMAP.md](../ROADMAP.md) — what to do next, and in what order
- [docs/FUTURE.md](FUTURE.md) — everything outstanding, with what each would cost
- [FORK.md](../FORK.md) — why a plain upstream build does not run
- [SECURITY.md](../SECURITY.md) — token handling
