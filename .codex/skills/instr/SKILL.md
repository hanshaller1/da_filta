---
name: instr
description: Erstellt aus der aktuellen Besprechung eine konkrete, konsolidierte und direkt kopierbare Arbeitsanweisung für den Coding-Agenten.
---

Schreibe Anweisung.

Nutze den aktuellen Gesprächs- und Projektkontext vollständig. Fasse die zuletzt gemeinsam festgelegten Anforderungen, Entscheidungen, Fehlerursachen, gewünschten Änderungen, Grenzen und Akzeptanzkriterien zu einer einzigen klaren Implementierungsanweisung zusammen.

Die Anweisung soll:
- direkt an einen Coding-Agenten übergeben werden können,
- konkret und eindeutig statt allgemein formuliert sein,
- bestehende Architektur und bereits getroffene Designentscheidungen respektieren,
- Scope und Nicht-Scope klar trennen,
- keine bereits verworfenen Varianten wieder einführen,
- relevante Tests bzw. Akzeptanzkriterien enthalten,
- bei Bugfixes die Ursache statt nur Symptome adressieren,
- keine unnötigen Refactorings oder Änderungen außerhalb des besprochenen Bereichs verlangen.

Wenn aus dem Kontext technische Details bereits eindeutig hervorgehen, übernimm sie ohne Rückfrage.
