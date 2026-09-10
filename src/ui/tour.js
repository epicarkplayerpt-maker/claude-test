/**
 * The guided tour.
 *
 * A scripted walk that shows the block's story in about four minutes: the same
 * six places, seen in the decades where they change most. It exists because
 * this scene has a narrative buried in it and a first-time visitor with free
 * movement will usually miss it entirely.
 *
 * Any input from the player abandons the tour immediately — it never traps you.
 */

import * as THREE from 'three';

const P = (x, z) => new THREE.Vector3(x, 0, z);

export const STEPS = [
  { era: 0, teleport: P(16, -44), look: P(18, 8, -30), wait: 1.0,
    say: 'Corner of Fifth and Vine. Autumn, 1945.' },
  { look: P(18, 7.5, -30), wait: 4.6,
    say: 'The Palace opened in 1927 with two thousand seats and a Wurlitzer organ. Tonight it is showing The Lost Weekend.' },
  { move: P(2, -40), look: P(-2, 3, -30), wait: 4.4,
    say: 'Schmidt’s Drugs mixes phosphates behind a marble counter. Otto Schmidt will not sell to a chain. Not yet.' },
  { move: P(-40, -14), look: P(-30, 3, -6), wait: 4.2,
    say: 'Marconi and Sons stacks the good apples at the front. Two of the sons came home in July.' },
  { move: P(-40, 20), look: P(-24, 3, 14), wait: 5.0,
    say: 'A tenement burned here in 1941. The neighbours cleared it themselves and planted cabbages — and somebody put a sapling in the north corner. Remember the sapling.' },

  { era: 1, wait: 3.4,
    say: 'Twenty years on. The cabbages lost to a two-pump filling station, but the tree survived, because the contractor’s daughter cried about it.' },
  { move: P(-40, -6), look: P(-30, 4, -4), wait: 4.0,
    say: 'Self service. You take a cart and touch the food yourself, which struck people as unsanitary for about a year.' },
  { move: P(20, -42), look: P(18, 8, -30), wait: 4.4,
    say: 'The Palace was clad over in 1958, because old looked poor. The terracotta is still under there.' },

  { era: 2, wait: 4.2,
    say: '1985. The cinema closed six years ago. A man rents videotapes out of the lobby, under a marquee that has lost its A.' },
  { move: P(-40, 20), look: P(-24, 1, 14), wait: 5.0,
    say: 'The pumps came out in ’78. Somebody cut the tree down the same week — for two extra parking spaces. One of them is still empty.' },
  { move: P(14, 40), look: P(7.5, 2.5, 20), wait: 4.6,
    say: 'And in the alley, somebody has signed the wall. It says KAI. Nobody ever found out who that was.' },

  { era: 3, wait: 4.4,
    say: '2005. They dug this lot out for forty-two luxury residences. They found the old fuel tanks in March, which cost them eight months.' },
  { move: P(-40, 24), look: P(-24, 3, 18), wait: 4.6,
    say: 'Under the tanks, a wall. In the wall, a tin box. Nobody wrote down where it went.' },

  { era: 4, wait: 4.8,
    say: '2025. The annex was never built — the crash killed it, and the lot sat behind hoarding for eleven years. Four hundred signatures turned it into this.' },
  { move: P(-38, 22), look: P(-26, 5, 16), wait: 4.4,
    say: 'A new tree, planted in 2021. Not the same tree. The plaque is careful about that.' },
  { move: P(18, -42), look: P(18, 8, -30), wait: 4.2,
    say: 'And the Palace came back, after nine years of argument and three lawsuits.' },

  { era: 5, wait: 5.0,
    say: '2055. The block was not replaced. It was re-grown — vertical farms on a 1904 grocery, clip-on housing above a 1912 hotel.' },
  { move: P(-38, 22), look: P(-26, 8, 16), wait: 5.2,
    say: 'Two trees, eighty years, one corner. The plaque names both. Under the roots is a tin box the 2007 excavation missed by four metres.' },
  { move: P(20, -42), look: P(18, 8, -30), wait: 6.0,
    say: 'And the marquee plays back every sign this building ever wore. Nine minutes, then it starts again at 1927. People sit on the kerb and watch the whole loop.' },
  { wait: 3.0, say: 'The block is yours. Look for the cat.' },
];

export class Tour {
  constructor(deps) {
    this.player = deps.player;
    this.hud = deps.hud;
    this.setEra = deps.setEra;
    this.audio = deps.audio;
    this.active = false;
    this.i = 0;
    this.t = 0;
    this.waitingEra = false;
  }

  start() {
    this.active = true;
    this.i = -1;
    this.t = 0;
    this.player.frozen = true;
    this.hud.toast('Guided tour', 'Move or look to take control at any time');
    this.next();
  }

  stop(silent = false) {
    if (!this.active) return;
    this.active = false;
    this.player.frozen = false;
    this.hud.subtitle(null);
    if (!silent) this.hud.toast('Tour ended', 'The block is yours');
  }

  next() {
    this.i++;
    this.t = 0;
    if (this.i >= STEPS.length) { this.stop(true); this.hud.toast('That’s the tour', 'Now go and find the rest'); return; }
    const s = STEPS[this.i];
    if (s.teleport) {
      this.player.pos.copy(s.teleport);
      this.player.pos.y = 0;
    }
    if (s.era !== undefined) {
      this.waitingEra = true;
      Promise.resolve(this.setEra(s.era)).then(() => { this.waitingEra = false; });
    }
    if (s.say) this.hud.subtitle(s.say, (s.wait || 4) + 1.4);
  }

  update(dt, input) {
    if (!this.active) return;

    /* Any deliberate input hands control back. */
    if (input && (input.moveMag > 0.25 || Math.abs(input.look.x) > 0.02 || Math.abs(input.look.y) > 0.02 || input.jumpPressed)) {
      this.stop();
      return;
    }

    const s = STEPS[this.i];
    if (!s) return;
    if (this.waitingEra) return;

    let arrived = true;
    if (s.move) arrived = this.player.moveTo(s.move, dt, 1.6, 2.0);
    if (s.look) this.player.lookAt(s.look, false, dt);
    this.player.applyToCamera(false);

    this.t += dt;
    if (this.t > (s.wait ?? 4) && arrived) this.next();
    // Never let a blocked path stall the tour.
    if (this.t > (s.wait ?? 4) + 8) this.next();
  }
}
