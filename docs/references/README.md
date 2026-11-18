# Visual references

Screenshots the project owner supplied to show the presentation they want for the
capital city and the Hall of Heroes. They are references for genre conventions
only. Star Dominion keeps its own sci-fi setting, art and names, and does not
copy any of these games' buildings, characters or interface art.

| File | What to take from it |
|---|---|
| `capital-walled-city.jpg` | A 3D city seen from a high, angled camera. A wall rings the city, roads divide it into plots, a central plaza, greenery fills empty ground, and each building carries a small status marker. |
| `capital-plateau-city.jpg` | The city sits on a raised plateau above the landscape. The main keep stands on the highest tier. Every building has a name tag with a level badge. |
| `capital-timers-labels.jpg` | Buildings under construction show a progress bar and countdown above them. A numbered tag marks each building. The camera is close enough that individual buildings read clearly. |
| `capital-panorama.jpg` | The city is framed by walls in the foreground and the keep at the back, against open sky and clouds. Light, saturated colours and roofs in one accent colour. |
| `hero-detail.jpg` | Hero screen: a roster column on the left, a full-body figure in the centre on a lit stage, and level, experience, power, equipment slots and skills on the right. |

How these are used in the game:

- **Capital** (`src/ui/render/capital3d.ts`, `src/ui/screens/Capital.tsx`): Three.js scene with a floating plateau, rampart wall with towers and a shield dome, a plot grid with roads and trees, procedural buildings that grow taller with level, roofs in the realm's colour, scaffolding and countdowns for work in progress, and name and level tags in an HTML overlay.
- **Hall of Heroes** (`src/ui/render/hero3d.ts`, `src/ui/screens/Heroes.tsx`): a procedural full-body figure on a lit stage, dressed for the character's role and realm, with equipment and skills beside it.
