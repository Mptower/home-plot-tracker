# Changelog

## 0.5.0

Your garden can now be saved to a file and put back — and the frost warning has
stopped being quiet about plants it was not sure of.

- **Save a copy of your garden.** There is a new section at the bottom of
  Settings. Press **Save a copy** and you get a single dated file with every
  seed packet, bed and harvest in it. It is worth doing before you change
  anything big, and worth doing now.
- **And put one back.** Pick a file and the app tells you what is in it — "3
  seed packets, 2 beds, 14 harvests" — **before** anything happens. Nothing
  changes until you confirm. If you restore the wrong file, an **undo** appears
  and puts back exactly what was there a moment ago.
- **A restore cannot half-happen.** If anything in the file is wrong, the whole
  restore is refused and your garden is left exactly as it was. It also takes
  its own safety copy first, every time, without being asked.
- **A tomato filed under the wrong category is now warned about anyway.** The
  0.4.0 note said that a tomato filed as a leafy green is treated as frost-hardy
  and **you would not be warned about it**. That is no longer true. For the cold
  question only, the app now takes the more cautious of what you filed and what
  it knows about the plant by name, so the warning happens either way.
  - Your records are still untouched. The Seed Vault, the chips and the crop
    rotation reminder all still read exactly the category you chose — this
    affects the frost warning and nothing else.
  - It is deliberately careful. It only applies when it recognises the whole
    name, so "Chocolate Cherry" is not mistaken for a cherry. A plant it cannot
    place stays quiet rather than guessing.
  - The blue note in the Seed Vault is still worth accepting. The category is
    what crop rotation counts, and that still reads what you filed.
- **Plants you have no seed packet for are covered too.** If you planted
  something in a bed straight from the plant list, the frost warning now knows
  what it is instead of skipping it.
- **The frost warning tells you what to do first.** It used to open with
  botany — "Nightshades are tender". It now opens with the action and names the
  bed: *"Cover your Cherry Tomato in Tomato bed — it'll be coldest around 3am."*
  When it is too cold for a cover to help, it says to pick what you can instead.
- **The banner in the app and the notification on your phone now say the same
  thing.** They had drifted into two different voices for the same night. The
  banner has more room, so it lists every bed rather than shortening to "and 2
  more".
- **Worth checking after updating: are frost notifications switched on?** They
  are currently off, so frost warnings are only appearing inside the app. If you
  want them on your phone, turn them on in Settings. The app will not switch
  them on by itself.

## 0.4.0

You no longer have to know what botanical family a plant belongs to.

- **The app knows the plants now.** Start typing a variety when you add a seed
  packet — "jalap", "cherry tom", "rosemary" — and pick it from the list. The
  category fills itself in. Around 170 common garden plants are in there:
  peppers (bell, jalapeño, habanero, serrano, poblano, cayenne, banana, ghost,
  shishito, Anaheim), tomatoes including the named heirlooms, a proper herb
  shelf, the berries and the fruit, squashes, beans, brassicas, onions, roots
  and the rest.
- **You can still type anything you like.** Seed from a neighbour, an unlabelled
  packet from a swap, a name only you use — all still fine. You just pick the
  category yourself, exactly as before. And if the app fills one in and you
  disagree, change it; your answer wins.
- **Please check the Seed Vault after updating.** If anything on your shelf is
  filed under a category the app thinks is wrong, you will see a blue note at
  the top offering to fix it, and telling you what difference it makes. This
  matters more than it sounds: the category is how the frost warning decides
  whether a plant is at risk, so a tomato filed as a leafy green is treated as
  frost-hardy and **you would not be warned about it**.
- **Nothing was changed for you.** The update has not touched a single one of
  your records. The blue note is an offer, and "Keep mine" makes it go away for
  good. This was a deliberate decision: they are your records.
- **Strawberries and the like are now covered.** There was no fruit category at
  all before, which meant berries had no frost tenderness and were silently
  left out of every warning. There are now three more categories — Fruit,
  Flower and Other — so nothing common falls through the gap. Melons stay under
  Cucurbit with the squashes, because that is the family they actually share
  pests and diseases with.
- **Planting a bed offers your own seeds first**, then the wider plant list
  underneath. Anything planted from the wider list is marked as not being in
  your vault, because frost warnings need a seed packet to work from.
- **The harvest form suggests what you have actually planted**, not just what is
  in the vault. If you have a packet called "Cherry Tomato" and you log the
  picking as "Tomato", the season totals count them as two different plants —
  this is how that stops happening.
- **You can now change what grew in a bed last year.** That was only settable
  when the bed was first created and there was no way to edit it afterwards,
  which meant the crop rotation reminder had nothing to compare against for
  most beds. It is in the bed details panel beside the grid.

## 0.3.0

Frost settings move into the app.

- **A Settings page in the Garden panel.** Frost notifications and quiet hours
  are now changed from inside the app, alongside the beds and the harvest log,
  instead of from the add-on's Configuration tab.
- **Changes apply immediately.** Turning notifications on or off, or moving
  quiet hours, is honoured within a few minutes. There is no longer anything
  to restart.
- **Check your settings once after updating.** Home Assistant clears an add-on's
  configuration for options the add-on no longer declares, so these three
  usually do not survive the update. The app starts them at **notifications
  off, quiet hours 21:00–07:00**. If you had notifications off, nothing
  changes. If you had them on, switch them back on — the app will not start
  notifying you because of an update, only because you asked it to.
- **The page explains itself.** It says in plain words that a frost less than
  twelve hours away is announced even during quiet hours, and that setting
  both times to the same value switches quiet hours off. Neither was ever
  written down anywhere you would look.
- **A status panel** shows whether Home Assistant is answering, which weather
  entity is being watched, which sensors are published and which time zone
  quiet hours are read against. It is there for when no frost warning appears
  and you want to know whether that means "nothing is coming" or "something is
  broken".
- The Configuration tab now holds only the entity plumbing — weather entity,
  notify service, sensor prefix — which is set once and rarely touched. Frost
  notifications and quiet hours are no longer there, deliberately: two
  settings pages that disagree is worse than one that is slightly further
  away.

## 0.2.0

Connects the garden to the rest of Home Assistant.

- **Frost warnings.** Reads the forecast from your weather entity and shows a
  banner in the app when a frost is coming, with the night and the coldest
  hour. Tender crops you have actually planted are named, so an empty bed
  never raises an alarm.
- **Four sensors**, published as `sensor.garden_*`: harvest weight, harvest
  count, top variety and frost risk. Usable in your own dashboards and
  automations.
- **Optional phone notification** for frost, with quiet hours so it will not
  wake you — unless the frost is within twelve hours, when morning would be
  too late to cover anything. **Off by default**; turn it on in the add-on's
  Configuration tab.
- Weather entity, notify service and sensor prefix are all settings rather
  than constants, so renaming an entity in Home Assistant does not need a new
  release. A bad entity id logs a warning and the garden still loads.
- Needs the Home Assistant API, which this version requests for the first
  time. Nothing reaches the browser: the token stays server-side and the app
  is given only what it needs to draw the banner.
- The app works exactly as before if the integration is unavailable or
  switched off. Nothing here is required to plan a bed or log a harvest.

## 0.1.0

First release.

- Runs the whole app — API and web client — in one Node process behind Home
  Assistant ingress, with no login and no exposed port.
- Stores the garden in SQLite at `/data/home-plot-tracker.db`, so Home
  Assistant's own backups include it.
- Adds a **Garden** panel to the sidebar.
- Builds for `amd64` and `aarch64`.
