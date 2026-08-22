The pink that stands for notes in the activity charts has only been proven readable next to the three colours it currently sits beside, so it leaves here with a warning rather than a clean bill of health.

The activity charts draw one coloured series — one line or bar per kind of activity — for work, for done, for bugs, for notes. Each of those needs a colour a reader can tell apart from the others at a glance. If two of them land too close together, the chart stops telling anyone anything: you can see two shapes and not know which is which.

The note series was given `--series-note: #c9629b`, a mid pink. It was then put through the dataviz palette validator — the checker that says whether two colours sharing a picture stay distinguishable — against the work, done and bug colours. Those are the only colours it is actually drawn beside today, and against those three it passed.

The part worth carrying forward is what the check did not cover. The validator was pointed only at the real neighbours, not at the whole palette. Two things were left out: fix-purple, and the grey scale. Nobody has measured the note pink against either of them. That is the trap this note exists to spring early, because a colour that has "passed the validator" reads as approved everywhere, and the next person adding a chart would have no reason to doubt it.

So the evidence is one validator run covering exactly three pairings. It would catch the note pink sitting too close to work, done or bug in the charts that ship today. It would catch nothing else.

What is different now: today's charts are sound as far as anyone has checked, and there is a written rule for whoever comes next. Before building a chart that puts `#c9629b` next to fix-purple or a grey, run the palette validator on that pairing. Until someone does, that pairing is unknown — not safe, just untested.
