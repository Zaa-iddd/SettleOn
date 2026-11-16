// Balance check: 3 greedy bots play 5 matches using the real rules. Run: npm run sim
import * as G from '../src/shared/game.js';
// 3 greedy bots: prefer monument > house > producers of scarcest resource > road
for (let trial = 0; trial < 5; trial++) {
  const s = G.createGame(1000 + trial);
  const ids = ['a','b','c'];
  for (const id of ids) { G.addPlayer(s, id, id);
    outer: for (let y=0;y<G.MAP_H;y++) for (let x=0;x<G.MAP_W;x++) if (G.canBuild(s,id,'town',x,y).ok && Math.random()<0.1) { G.build(s,id,'town',x,y); break outer; } }
  ids.forEach(id => { if (!G.hasTown(s,id)) for (let y=0;y<G.MAP_H && !G.hasTown(s,id);y++) for (let x=0;x<G.MAP_W;x++) if (G.canBuild(s,id,'town',x,y).ok) { G.build(s,id,'town',x,y); break; } });
  G.startMatch(s, 0);
  let t = 0;
  while (s.phase === 'playing') {
    t += G.TICK_MS; G.tick(s, t);
    for (const id of ids) {
      for (let k = 0; k < 3; k++) {
        const p = s.players[id]; const prod = G.productionFor(s,id);
        const scarce = G.RESOURCES.reduce((a,b)=> prod[a] <= prod[b] ? a : b);
        const prodFor = { wood:['mill'], stone:['quarry'], food:['farm','dock'] }[scarce];
        const order = ['monument','house', ...prodFor, 'farm','mill','quarry','dock','road'];
        let done = false;
        for (const type of order) { const spots=[]; for (let y=0;y<G.MAP_H;y++) for (let x=0;x<G.MAP_W;x++) if (G.canBuild(s,id,type,x,y).ok) spots.push([x,y]);
          if (spots.length) { const [x,y]=spots[Math.floor(Math.random()*spots.length)]; G.build(s,id,type,x,y); done = true; break; } }
        if (!done) { const rich = G.RESOURCES.reduce((a,b)=> p.res[a] >= p.res[b] ? a : b); if (p.res[rich] >= 6 && rich !== scarce) G.trade(s,id,rich,scarce); else break; }
      }
    }
  }
  console.log(`trial ${trial}: ended at ${(t/60000).toFixed(1)} min`, G.standings(s).map(x=>`${x.name}:${x.renown}(land ${x.land})`).join(' '));
}
