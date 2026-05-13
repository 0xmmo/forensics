import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TITLES = [
  // nursery rhymes / children's
  'Yankee Doodle',
  'Row, Row, Row Your Boat',
  'Twinkle, Twinkle, Little Star',
  'Mary Had a Little Lamb',
  'Old MacDonald Had a Farm',
  "She'll Be Coming 'Round the Mountain",
  'The Wheels on the Bus',
  "If You're Happy and You Know It",
  'Oh My Darling, Clementine',
  'Hush, Little Baby',
  'Skip to My Lou',
  'Pop Goes the Weasel',
  'Three Blind Mice',
  'Itsy Bitsy Spider',
  'This Old Man',
  'Bingo (song)',
  'London Bridge Is Falling Down',
  'Baa, Baa, Black Sheep',
  'Hey Diddle Diddle',
  'Hickory Dickory Dock',
  'Humpty Dumpty',
  'Jack and Jill (nursery rhyme)',
  'Little Bo-Peep',
  'Little Boy Blue',
  'Little Miss Muffet',
  "Ring a Ring o' Roses",
  'Sing a Song of Sixpence',
  'There Was an Old Lady Who Swallowed a Fly',
  'Old Mother Hubbard',
  'Polly Put the Kettle On',
  'This Little Piggy',
  'Rub-a-dub-dub',
  'The Grand Old Duke of York',
  'Wee Willie Winkie',
  "Pop! Goes the Weasel",
  'Frère Jacques',
  'Greensleeves',
  'Auld Lang Syne',

  // 19th-century parlour and minstrel songs
  'Camptown Races',
  'Oh! Susanna',
  "I've Been Working on the Railroad",
  'Home on the Range',
  'My Bonnie Lies over the Ocean',
  'When the Saints Go Marching In',
  'Swing Low, Sweet Chariot',
  'Take Me Out to the Ball Game',
  "For He's a Jolly Good Fellow",
  'Daisy Bell',
  'In the Good Old Summertime',
  'After the Ball (song)',
  "Bill Bailey, Won't You Please Come Home",
  'Shine On, Harvest Moon',
  'Sweet Adeline (ballad)',
  'My Old Kentucky Home',
  'Beautiful Dreamer',
  'Jeanie with the Light Brown Hair',
  'Aura Lea',

  // christmas carols
  'Jingle Bells',
  'Silent Night',
  'O Christmas Tree',
  'Hark! The Herald Angels Sing',
  'Joy to the World',
  'We Wish You a Merry Christmas',
  'Deck the Halls',
  'O Holy Night',
  'Carol of the Bells',
  'Good King Wenceslas',
  'What Child Is This?',
  'The First Noel',
  'O Come, All Ye Faithful',
  'Angels We Have Heard on High',
  'It Came Upon the Midnight Clear',
  'I Heard the Bells on Christmas Day',
  'God Rest You Merry, Gentlemen',
  'We Three Kings',
  'The Twelve Days of Christmas (song)',
  'Away in a Manger',
  'The Holly and the Ivy',
  'Coventry Carol',

  // hymns / spirituals
  'Amazing Grace',
  'Battle Hymn of the Republic',
  'Onward, Christian Soldiers',
  'Holy, Holy, Holy! Lord God Almighty',
  'Rock of Ages (Christian hymn)',
  'A Mighty Fortress Is Our God',
  'Abide with Me',
  'When the Roll Is Called Up Yonder',
  'Just a Closer Walk with Thee',
  'In the Garden (1912 song)',
  'Nearer, My God, to Thee',
  'How Firm a Foundation',
  'Down by the Riverside',
  'Joshua Fit the Battle of Jericho',
  "Nobody Knows the Trouble I've Seen",
  'Go Down Moses',
  'Wade in the Water',
  'Michael, Row the Boat Ashore',
  'We Shall Overcome',
  'Kumbaya',
  'Were You There',

  // patriotic / national
  'The Star-Spangled Banner',
  'America the Beautiful',
  "You're a Grand Old Flag",
  'God Save the King',
  'La Marseillaise',
  'God Bless America',
  'Hail, Columbia',
  'My Country, Tis of Thee',

  // civil war / military
  'When Johnny Comes Marching Home',
  'Marching Through Georgia',
  'Tenting on the Old Camp Ground',
  'Dixie (song)',
  "John Brown's Body",
  'Tramp! Tramp! Tramp!',
  'Aura Lee',

  // folk / americana
  'Goodnight, Irene',
  'Streets of Laredo',
  'Red River Valley (song)',
  'Sweet Betsy from Pike',
  'On Top of Old Smoky',
  'Polly Wolly Doodle',
  'Down in the Valley (song)',
  "There's a Hole in My Bucket",
  'Erie Canal (song)',
  'Big Rock Candy Mountain',
  'Cotton-Eyed Joe',
  'Cripple Creek (song)',
  "Soldier's Joy",
  'Old Joe Clark',
  'John Henry (folklore)',
  'Stewball',
  'Tom Dooley (song)',
  'Wayfaring Stranger (song)',
  'Shenandoah (song)',
  'Buffalo Gals',
  'The Yellow Rose of Texas (song)',

  // sea shanties
  'Drunken Sailor',
  'Blow the Man Down',
  'Spanish Ladies',
  'Haul Away Joe',
  'South Australia (song)',
  'Leave Her Johnny',
  'Wellerman',
  'Santiana (song)',
  'Shenandoah',

  // british isles
  'Danny Boy',
  'The Wild Rover',
  'Molly Malone',
  'Loch Lomond (song)',
  'The Parting Glass',
  'Whiskey in the Jar',
  'The Irish Rover',
  'Scarborough Fair (ballad)',
  'The Skye Boat Song',
  'Annie Laurie',
  'Comin Thro the Rye',
  'The Bonnie Banks o Loch Lomond',
  'The Lass of Aughrim',
  'The House of the Rising Sun',
];

const OUT_PATH = process.env.CONTEXT_PATH ?? 'contexts/wiki-songs.md';
const UA = 'attention-research/0.1 (https://github.com/local; m.moustafa@outlook.com)';

type WikiResponse = {
  query?: {
    pages?: Record<string, { title?: string; extract?: string; missing?: boolean }>;
  };
};

async function fetchExtract(title: string): Promise<string> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'extracts');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('exlimit', '1');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('titles', title);
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${title}`);
  const data = (await res.json()) as WikiResponse;
  const pages = data.query?.pages ?? {};
  const first = Object.values(pages)[0];
  if (!first || first.missing) return '';
  return (first.extract ?? '').trim();
}

mkdirSync(dirname(resolve(OUT_PATH)), { recursive: true });

const parts: string[] = [];
let totalChars = 0;
for (const title of TITLES) {
  process.stdout.write(`${title} ... `);
  try {
    const text = await fetchExtract(title);
    parts.push(`# ${title}\n\n${text}`);
    totalChars += text.length;
    console.log(`${text.length.toLocaleString()} chars`);
  } catch (e) {
    console.log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const out = parts.join('\n\n---\n\n');
writeFileSync(OUT_PATH, out, 'utf8');
console.log(`\nwrote ${out.length.toLocaleString()} chars (${TITLES.length} titles, ${totalChars.toLocaleString()} extract chars) → ${OUT_PATH}`);
