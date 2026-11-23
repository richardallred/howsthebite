# Lure drawing prompts

Prompts for the lure drawings the "What to throw" cards still need. Each card matches its
suggestion's name to a drawing (`LURE_DRAWINGS` in `js/app.js`); these 15 cover the suggestions
that today get a drawing of some other lure, or none.

Each prompt stands on its own: paste it whole. They share one style paragraph so the new drawings
match the 13 already in `art/lures/`: black-ink woodcut on a flat light grey ground, side view,
3:2 landscape (the existing files are 2528×1696). The card shows the drawing at about 116×78
pixels, so the prompts ask for bold outlines over fine detail.

Status: all 15 are drawn, traced and wired up.

## After generating

1. Save the image as `art/lures/<id>-gemini.jpg`.
2. Trace it: `python3 art/trace.py art/lures/<id>-gemini.jpg drawings/lures/<id>.svg /dev/null --tight --darken`
   (`--darken` gives grey engravings the line weight of the black-ink originals; leave it off for
   an image that is already solid black ink).
3. Add `.lure-drawing[data-lure="<id>"] { --drawing: url("drawings/lures/<id>.svg"); }` to
   `styles.css` beside the others, and `'drawings/lures/<id>.svg'` to `SHELL` in `sw.js` so it
   works offline.
4. Add `['<id>', /pattern/i]` to `LURE_DRAWINGS`, above any family whose pattern would catch
   the name first (bucktail above the generic `/bucktail/` jig line, lipless above crankbait).
   Then check every suggestion still lands where it should.

Check each result against the "Must show" line before tracing. Image generators tend to drift
back to the generic lure (a cupped popper, a skirted bass jig), and that is the mistake these
drawings are meant to fix.

---

## 1. Jig and minnow (`jig-minnow`)

Covers: Jig and minnow · Jig and minnow below the dam · Jig and minnow in the current · Jig and a
big minnow on rocky points · Heavier jig, 1/4 oz or more · Light jig with a plastic or minnow in
shallow bays · Small jig tipped with a minnow or worm

Must show: a bare round jighead and a real minnow. No skirt, no craw.

```
A black-ink woodcut engraving of a walleye jig tipped with a live minnow, seen from the side and laid out horizontally. A plain round lead jighead with the line-tie eye on top and a single short hook; a small live shiner minnow hooked up through both lips onto the jig hook, its body trailing straight back behind the head with fins, scales and an eye drawn in. No skirt, no rubber legs, no plastic trailer. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 2. Walking topwater (`walking-topwater`)

Covers: Pencil popper · Walk-the-dog topwater plug · Walk-the-dog topwater or mullet swimbait ·
Walking topwater at first light · Walking topwater bait

Must show: a long, cigar-shaped body with a pointed nose. No cupped face, no lip.

```
A black-ink woodcut engraving of a walk-the-dog topwater fishing lure, seen from the side and laid out horizontally. A long, slender, cigar-shaped hard plastic body that tapers to a rounded point at the nose and narrows again toward the tail; the line-tie eye at the very tip of the nose; a painted eye and a light scale pattern; two treble hooks hanging below, one under the belly and one at the tail. The face is solid and pointed: no cupped or concave mouth, no diving lip, no propeller, no feathers. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 3. Live bait on a circle hook (`live-bait`)

Covers: Live whitebait, free-lined · Live bait around bridge and dock lights · Live pinfish or
shrimp on a circle hook · Live shrimp or pinfish on a circle hook · Cut or live menhaden (bunker)

Must show: a whole live baitfish on one circle hook, with nothing else on the line.

```
A black-ink woodcut engraving of a live baitfish on a circle hook, free-lined, seen from the side and laid out horizontally. A short length of plain fishing line enters from the left and ties straight to a single circle hook, whose point curves back in toward the shank; the hook passes through the nose of a whole small baitfish (a pilchard or small mullet) swimming to the right, with fins, scales, gill plate and eye drawn in. Nothing else on the line: no sinker, no float, no swivel, no beads. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 4. Bucktail jig (`bucktail`)

Covers: Bucktail jig · Bucktail jig tipped with squid or a minnow · White bucktail or small soft
plastic in the beach trough · Pompano jig

Must show: a bullet head and a skirt of deer hair. No rubber strands, no craw.

```
A black-ink woodcut engraving of a bucktail jig, seen from the side and laid out horizontally. A smooth bullet-shaped lead head with a large painted eye and the line-tie eye on top; behind it, a long, full skirt of natural deer hair bound tight with thread at the collar and flowing straight back past the bend of a single large hook, the hook point turned up. The hair is fine, straight and slightly flared, not rubber strands. No plastic trailer, no crawfish, no feathers. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 5. Drop-shot rig (`drop-shot`)

Covers: Drop-shot with a small minnow bait · Drop-shot finesse worm · Drop-shot with a minnow or
piece of worm

Must show: the weight at the end of the line and the hook partway up it, above the weight.

```
A black-ink woodcut engraving of a drop-shot fishing rig, drawn on a gentle diagonal so it fills a landscape frame. A fishing line runs from the upper left toward the lower right. Partway along it, a small single hook is tied directly onto the line with its point turned up, and a slim, straight finesse worm is hooked through the nose on it, hanging out to the side. The line carries on past the hook to its end at the lower right, where a small teardrop-shaped sinker is clipped on. The weight is below the bait, at the very end of the line. No float, no swivel. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no lake bed, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 6. Fly (`fly`)

Covers: Dry fly or small nymph when insects hatch · Egg pattern or small nymph drifted deep
(or give that one to `egg`)

Must show: a recognisable tied fly, drawn large.

```
A black-ink woodcut engraving of a single trout dry fly, seen from the side and drawn large, laid out horizontally. A small fine-wire hook with the eye at the left; at the front, a stiff collar of hackle fibres radiating around the shank, two upright wings standing up above it, a slim tapered body wrapped with thread ribbing, and a few long, fine tail fibres sweeping back past the bend. No line, no reel, no water. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 7. Egg cluster and yarn (`egg`)

Covers: Cured eggs or a yarn ball drifted near the bottom

Must show: round eggs and a puff of yarn on one hook.

```
A black-ink woodcut engraving of a salmon egg bait, seen from the side and laid out horizontally. A single short-shank octopus hook with its eye at the left; a small cluster of round, glossy cured salmon eggs held on the hook, each egg a clean circle with a highlight, and a fluffy puff of yarn tied in at the eye just in front of them. A short length of line leading off to the left. No sinker, no float. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no gravel, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 8. Blade bait (`blade-bait`)

Covers: Blade bait · Blade bait or jigging spoon

Must show: a thin, flat blade in the outline of a baitfish, with holes along the back. Not a
curved spoon.

```
A black-ink woodcut engraving of a blade bait fishing lure, seen from the side and laid out horizontally. A thin, flat stamped metal blade cut in the outline of a small baitfish, with a moulded lead weight forming the head and the front of the belly; a row of three small round holes along the top edge of the blade, with a snap clipped into the middle one; one treble hook hanging from the belly and one from the tail. The blade is flat, not curved like a spoon. A painted eye on the lead head and a few engraved scale lines on the metal. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 9. Soft-plastic shrimp on a jighead (`soft-shrimp`)

Covers: Soft-plastic shrimp on a jighead under dock or bridge lights · Soft-plastic shrimp under
feeding birds

Must show: a shrimp on a jighead, with no cork.

```
A black-ink woodcut engraving of a soft-plastic shrimp lure on a jighead, seen from the side and laid out horizontally. A small round lead jighead at the left with the line-tie eye on top; a realistic rubber shrimp threaded onto the hook tail-first, so its fanned tail sits against the jighead and its body runs back to the right, with segmented shell, curled legs underneath, a pointed rostrum, beady eyes and long sweeping antennae trailing behind. The hook point comes out through the top of its back. No float, no cork, no bobber. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 10. Live worm and split shot (`live-worm`)

Covers: Worm with extra split shot · Worm or cricket on a small hook near the beds

Must show: a real earthworm with its loose ends hanging free, and small round shot on the line.
Not a plastic worm.

```
A black-ink woodcut engraving of a live earthworm on a small fishing hook, seen from the side and laid out horizontally. A length of fishing line enters from the left; two small round split-shot sinkers are pinched onto the line a short way above the hook; then a thin, long-shank hook with a live nightcrawler threaded on it in a loose loop, its two soft ends dangling free, the worm's body ringed with fine segments and a smooth band (the clitellum). The worm is natural and limp, not a moulded plastic worm. No float, no jighead. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no soil, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 11. Lipless crankbait (`lipless`)

Covers: Lipless crankbait

Must show: a flat-sided body with no lip, and the line tie on its back.

```
A black-ink woodcut engraving of a lipless crankbait fishing lure, seen from the side and laid out horizontally. A deep-bodied, flat-sided hard bait shaped like a shad, with a steep sloping forehead and no diving lip at all; the line-tie eye sits on top of the back just behind the head; a painted eye, gill line and scale pattern; one treble hook hanging from the belly and one from the tail. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 12. Hollow-body frog (`frog`)

Covers: Hollow-body frog

Must show: a soft frog body, two rubber legs and an upturned double hook on its back.

```
A black-ink woodcut engraving of a hollow-body frog fishing lure, seen from the side and laid out horizontally. A soft, rounded pouch-shaped body with a frog's head, bulging eyes and a textured, speckled back; two bunches of thin rubber skirt strands trailing from the rear as legs; a double hook whose two points curve up and lie snug against the top of the back; a small line-tie eye at the nose. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no lily pads, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 13. Bladed jig (`bladed-jig`)

Covers: Swim jig or bladed jig

Must show: a hexagonal metal blade on the front of the jighead.

```
A black-ink woodcut engraving of a bladed swim jig (a vibrating jig) fishing lure, seen from the side and laid out horizontally. A flat, six-sided metal blade at the very front, joined to the nose of a small lead jighead by a snap and split ring, with the line tied to the blade; behind the head, a full, flowing skirt of thin rubber strands; a single hook coming up through the skirt, with a soft-plastic paddle-tail trailer on it. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 14. Tube bait (`tube`)

Covers: Tube bait on the bottom

Must show: a hollow tube with a skirt of tentacles. Not a grub with a curly tail.

```
A black-ink woodcut engraving of a soft-plastic tube bait fishing lure, seen from the side and laid out horizontally. A hollow cylindrical soft-plastic body with a rounded, closed nose at the left, speckled along its length; the rear third split into a skirt of many fine, wavy tentacles; a lead jighead hidden inside the tube, with only the line-tie eye poking out of the nose and the hook point coming out through the top of the body. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no rocks, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```

## 15. Metal or epoxy jig (`metal-jig`)

Covers: Metal or epoxy jig cast into blitzes

Must show: a slim, heavy, baitfish-shaped metal jig. Not a curved spoon.

```
A black-ink woodcut engraving of a metal casting jig (an epoxy jig) fishing lure, seen from the side and laid out horizontally. A slim, dense, straight-sided jig shaped like a small baitfish such as a sand eel or anchovy, made of heavy metal with a clear epoxy coat over a printed body, a painted eye and a faint stripe along its side; a split ring at the nose for the line and a single treble hook on a split ring at the tail. Long, narrow and solid, not a curved spoon or a flat blade. Bold clean outlines with fine parallel hatching and crosshatching for shading; black ink only, no colour, no grey wash. Centred, filling most of a 3:2 landscape frame with a margin all round. Plain flat light grey background: no water, no table, no shadow, no hands, no text or labels. Keep the shapes simple and the lines heavy enough to read when shrunk to an icon about 120 pixels wide.
```
