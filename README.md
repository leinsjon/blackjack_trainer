# Blackjack Trainer

A casino-style web app for practicing blackjack basic strategy. Works on phones and desktops, no build step.

## Features

- **Basic strategy drills** with instant feedback on every decision (hit, stand, double, split, surrender).
- **Configurable rules**: decks (1, 2, 4, 6, 8), dealer hits or stands on soft 17, double after split, double on any two / 9–11 / 10–11, max split hands, resplit aces, late surrender, 3:2 or 6:5 blackjack. The correct answers follow the chosen rules.
- **Up to three hands per round**: pick a chip and tap a betting circle. Bets stay in place between rounds (default $100 on the middle spot).
- **Money tracking**: balance, session net, expected result, the EV each mistake cost in dollars (with a mistake log), and the EV lost to the house edge even with perfect play.
- **Standard deviation charts** in the Session panel: your net against ±1σ/±2σ bands given the cards you were dealt, and against bands from hand count and stakes alone.
- **Hi-Lo count**: running count and true count (running count ÷ decks left), hidden until you tap it.
- **Strategy chart** generated for the current rules.
- **New session** (top bar or Session panel) resets the balance and every stat, and saves the old session to an archive you can browse with its charts and mistakes.
- **Focused practice** on hard totals, soft totals or pairs.
- Keyboard shortcuts on desktop: H, S, D, P, R, and Space to deal.

## How EV is calculated

For each decision the app estimates the EV of every available action from the remaining shoe composition (full shoe minus the cards on the table), assuming the dealer has already checked for blackjack. Splits are valued as two hands without further resplits. The EV lost on a mistake is `EV(book play) − EV(your play)` times the money at risk on that hand.

"Expected" in the stats is the book-play EV of each hand you were dealt, minus the EV you gave up. Net minus Expected is luck.

The house edge for the chosen rules comes from standard published rule-effect estimates. The "hands and stakes only" chart uses a per-hand standard deviation of 1.15 bets and a 0.48 correlation between hands played in the same round.

Strategy tables are the standard total-dependent basic strategy for each rule set. Count-based deviations (index plays) are not part of the book play.

## Run locally

Any static file server works:

```sh
npm start        # serves on http://localhost:3000
npm test         # strategy, EV and game tests (Node 18+)
```

## Deploy on Render

1. In Render, choose **New → Static Site** and connect this repository.
2. Leave **Build Command** empty (or `echo ok`) and set **Publish Directory** to `.`.
3. Create the site. Every push to `main` redeploys.

Alternatively, `render.yaml` in this repo defines the same static site as a Blueprint (**New → Blueprint**).
