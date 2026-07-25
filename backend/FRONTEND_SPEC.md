## Storytelling : 
using the frontend of supermemory as inspiration, we're gonna make the frontend look really polished and cute. 
the idea is to be very clear from the begining, You'll never feel lost reading research papers ever again.

An average researcher reads thorugh hundereds of research papers every day, there's no way for them to remember and implement the papers. Until now. 

beginners can ask questions and make it interactive, ecperienced folks can take a coffee and vibe code papers now. 


Our ethos is simple, new coding models get through verified benchmarks to check their validity, but PolarisAI is'nt just a vibe code your way through app, its meant to tackle falsified numbers. In today's world where numbers matter most, lying was never easier. Polaris AI, is your north star to tackle all this. 


## Features presnet: 
there are 4 agents:  draw this graph and illuminate a small line in cyan going from one node to another
READ => RESEARCH => PLAN => CODE 

also add a terminal to the side in a small card to show what happens and it should dynamically tytpe also 

when they hover each add content to show waht it does, with a moving shine on the borders clockwise. 

the agent's tasks are in SPEC.md

## Features future: 
User's can write the code, train models and grab a cofee while at it because we handle the rest. (PAID)

GPU access => on priority (PAID)

customisations on the preexisting code that is genereted (PAID)

NPM registry for all the code to be installed in a jiffy if there's someone who does'nt like git clone. 

then add a way for them to start using the app from teh frontend. 

the redis thingy should be out aslo, it should be a basic chat interface with a sidebar for chatting and the center on for showing the files from the sandbox, and again add buttons to allow the user to approve or diaspporove the changes. 

Beyond this add Stripe as a paywall and an early sale of $1 (5$ without the early bird sale) as starter with 3 custom codes, 0.5x shared GPU access and 1 train JOB. 20$ pm gets 8 custom repos, 1x full GPU access and 200$ for unlimited customisations, upto 4x priority GPU's.

then a footer that says POLARIS in lettrs and upon hovered it glows up more than it already was. then add links for linkedin github twitter. ill give the links. 

### Visual direction and palette

Use the live Supermemory reference as the visual baseline: a bright white canvas, near-black ink, electric blue actions, pale blue utility surfaces, and cool blue structure. Keep Polaris’s research-specific agent colors as small semantic accents rather than as the page background.

```css
--bg:             #FFFFFF;                 /* page canvas */
--surface:        #FFFFFF;                 /* cards and panels */
--surface-alt:    #FAFAFA;                 /* muted card / input surface */
--surface-blue:   #F4F8FF;                 /* selected and informational surface */
--glass:          rgba(255,255,255,0.92);  /* panel glass */
--border:         rgba(15,46,92,0.10);     /* cool blue hairline */
--border-strong:  #C5DBF2;                 /* form and card border */

--blue:           #0562EF;                 /* primary action and citation link */
--blue-soft:      #7CB7FF;                 /* soft highlight / code accent */
--navy:           #0B1015;                 /* primary ink */
--navy-deep:      #07224F;                 /* dark information panel */
--teal:           #0562EF;                 /* live state, aligned to the primary system */
--pink:           #7CB7FF;                 /* PLAN agent accent */
--amber:          #F5A623;                 /* RESEARCH agent / warning */

--text:           #0B1015;                 /* headings and primary copy */
--text2:          #0562EF;                 /* secondary headings and links */
--text3:          rgba(11,16,21,0.60);      /* muted body copy */
--text4:          #888E94;                 /* timestamps and quiet labels */
--code-bg:        #13191F;                 /* terminal background */
--code-text:      #FAF7F2;                 /* terminal text */
```

The button, link, and selected-state blue is `#0562EF`; use it consistently for primary actions and evidence links. Cards should feel white and quiet, with `#F4F8FF` reserved for hover/selected states. Do not reintroduce the previous purple void palette unless a future dark mode is explicitly added.




