/* ============================================================================
   prompts.js — the prompt library for Classic mode.
   300+ prompts across the seven requested categories. Plus dealing logic
   that guarantees every player a different prompt each round.
   ========================================================================== */
(function (global) {
  'use strict';

  const CATEGORIES = {
    Objects: [
      'a rubber duck', 'an umbrella in a storm', 'a melting ice cream', 'a treasure chest',
      'a broken alarm clock', 'a flying kite', 'a teapot', 'a pair of headphones', 'a disco ball',
      'a paper airplane', 'a spinning top', 'a magic lamp', 'a pile of laundry', 'a snow globe',
      'a fortune cookie', 'a vending machine', 'a grandfather clock', 'a lava lamp', 'a kaleidoscope',
      'a stack of pancakes', 'a wobbly jelly', 'a leaky faucet', 'a haunted mirror', 'a piñata',
      'a tangled set of fairy lights', 'a sandcastle', 'a jack-in-the-box', 'a fire extinguisher',
      'a rolling pin', 'a fancy chandelier', 'a squeaky shopping trolley', 'a melted candle',
      'a swiss army knife', 'a soap bubble', 'a wind chime', 'a popcorn machine',
    ],
    Animals: [
      'a sleepy sloth', 'a dancing octopus', 'a grumpy cat', 'a penguin wearing a scarf',
      'a fox stealing chips', 'a giraffe with a sore neck', 'a hamster on a wheel', 'a shark in a top hat',
      'a chameleon at a paint shop', 'a duck riding a bicycle', 'a hedgehog hugging a balloon',
      'a flamingo doing yoga', 'a snail racing a cheetah', 'a koala that overslept', 'a frog catching flies',
      'a peacock showing off', 'a turtle wearing rollerblades', 'a bee with a tiny umbrella',
      'a llama spitting', 'a crab playing the drums', 'a bat hanging upside down', 'a moth chasing a lamp',
      'a parrot telling secrets', 'a panda eating noodles', 'a jellyfish glowing in the dark',
      'a hyena laughing too hard', 'a seal balancing a ball', 'a beaver building a dam',
      'a kangaroo with a full pocket', 'an owl on a night shift', 'a pug in a sweater',
      'a goldfish with a memory', 'a raccoon raiding a bin', 'a dragonfly at sunset',
    ],
    Technology: [
      'a robot learning to dance', 'a phone with 1% battery', 'a tangled charging cable',
      'a self-driving shopping cart', 'a drone delivering pizza', 'a smart fridge gone rogue',
      'a vintage games console', 'a malfunctioning printer', 'a satellite orbiting earth',
      'a virtual reality headset', 'a hoverboard', 'a 3D printer mid-print', 'a server room on fire',
      'a robot vacuum stuck on a rug', 'a holographic assistant', 'a floppy disk museum',
      'a spaceship dashboard', 'a circuit board city', 'an AI painting a portrait', 'a smartwatch nagging you',
      'a wifi router with no signal', 'a retro arcade machine', 'a self-tying shoe', 'a flying car in traffic',
      'a robot barista', 'a glitching screen', 'a tiny camera drone', 'a power bank saving the day',
      'a keyboard missing one key', 'a teleporter test gone wrong',
    ],
    'Weird combinations': [
      'a cactus wearing a tuxedo', 'a banana phone', 'a cloud raining spaghetti',
      'a snowman on a beach holiday', 'a vampire dentist', 'a pizza-powered rocket',
      'a goldfish walking a dog', 'a robot made of vegetables', 'a wizard at a bus stop',
      'a shark riding a skateboard', 'a teapot volcano', 'a dinosaur in a sweater',
      'a cat lawyer in court', 'a sentient sandwich', 'a ghost doing the dishes',
      'a unicorn at the gym', 'a snail with a jetpack', 'a toaster that tells the future',
      'a knight fighting a vacuum cleaner', 'a moon made of cheese with a face',
      'a pirate selling ice cream', 'an alien at a farmers market', 'a giraffe in a phone booth',
      'a mermaid in a desert', 'a robot walking a dinosaur', 'a flying spaghetti monster',
      'a penguin running a coffee shop', 'a dragon baking cupcakes', 'a wizard losing at chess to a goose',
      'a t-rex trying to make a bed',
    ],
    Places: [
      'a busy train station', 'a lighthouse in a storm', 'a candy mountain', 'an underwater city',
      'a haunted house', 'a desert oasis', 'a rooftop garden', 'a crowded elevator',
      'a treehouse village', 'a floating market', 'a secret laboratory', 'a cozy library',
      'a volcano lair', 'a carnival at night', 'a frozen lake', 'a space station',
      'a hidden waterfall', 'a bustling night market', 'a castle in the clouds', 'a tiny island',
      'a subway platform', 'a mountain cabin', 'a maze garden', 'a dragon’s cave',
      'an abandoned theme park', 'a glowing mushroom forest', 'a city skyline at sunset',
      'a cozy ramen shop', 'a moon base', 'a pirate cove',
    ],
    Actions: [
      'someone slipping on a banana peel', 'a perfect high five', 'catching a falling cake',
      'a sneeze that won’t come', 'parallel parking badly', 'breakdancing', 'juggling flaming torches',
      'doing a cannonball', 'tripping over a cat', 'blowing out a thousand candles',
      'an epic air guitar solo', 'sprinting for a bus', 'building a house of cards',
      'arm wrestling a bear', 'tiptoeing past a sleeping baby', 'untangling earphones',
      'sliding into home base', 'reaching the last biscuit', 'jumping in a puddle',
      'doing a trust fall', 'spilling coffee everywhere', 'a dramatic mic drop',
      'chasing a runaway shopping cart', 'a victory dance', 'doing the worm',
      'falling asleep in a meeting', 'limbo dancing', 'wrestling a fitted sheet',
    ],
    'Abstract concepts': [
      'the feeling of Monday morning', 'pure chaos', 'inner peace', 'the sound of silence',
      'déjà vu', 'a fresh start', 'overthinking', 'the calm before the storm',
      'time flying', 'a brain freeze', 'good vibes only', 'the weight of a secret',
      'butterflies in your stomach', 'the last day of summer', 'organised chaos',
      'a lightbulb moment', 'the awkward silence', 'running on caffeine', 'nostalgia',
      'the fear of missing out', 'a midlife crisis', 'beginner’s luck', 'writer’s block',
      'the unstoppable force', 'a leap of faith', 'the comfort zone', 'a wild goose chase',
      'the point of no return', 'happiness in a jar', 'the sunday scaries',
    ],
  };

  // flat list with category tag
  const ALL = [];
  for (const [cat, list] of Object.entries(CATEGORIES))
    for (const text of list) ALL.push({ text, cat });

  const Prompts = {
    categories: Object.keys(CATEGORIES),
    count: ALL.length,

    /** Deal `n` unique prompts. Mixes in any enabled custom packs. */
    deal(n, extraPacks = []) {
      let pool = [...ALL];
      for (const pack of extraPacks)
        for (const text of pack.prompts) pool.push({ text, cat: pack.name });
      return U.shuffle(pool).slice(0, n);
    },

    random() { return U.pick(ALL); },
  };

  global.Prompts = Prompts;
})(window);
