# Fatty research brief: Austin, TX restaurants

Research each spot in your list and write a JSON array to the output file named in your task.
Today is October 2026. Use the most recent info you can find (official site, Google Maps listing,
Yelp, Instagram, Eater/Austin Chronicle/Austin Monthly 2025–2026). If sources disagree, trust the most
recent official source. Note when a spot has moved, rebranded, or closed for good.

## Rules
- Only report facts you actually saw in a source. Never guess coordinates, hours or addresses.
  If you can't confirm something, use null and explain in "flags".
- Multi-location chains: pick ONE Austin location. Prefer the original/flagship Austin location
  in central Austin. Set "locations" to the approximate number of Austin-area locations.
- Food trucks/trailers: give the current lot/park address and add the tag "Food truck".
- If the name in the list is misspelled or ambiguous, find the best Austin match and explain in "flags".
  If you truly can't find it, status "not_found".

## Output object (one per spot, keep the input order)
{
  "input": "exact text from my list",
  "name": "official name, proper spelling/capitalization",
  "status": "open" | "closed_permanently" | "not_found" | "uncertain",
  "address": "street, Austin, TX ZIP" or null,
  "neighborhood": one value from the NEIGHBORHOODS list below,
  "cuisine": one value from the CUISINES list,
  "price": "$" | "$$" | "$$$" | "$$$$" | null,   (Google/Yelp price level)
  "hours": string in the HOURS format, or null,
  "lat": number or null, "lng": number or null,   (ONLY if a page you read shows coordinates; else null)
  "website": url or null,
  "instagram": "https://instagram.com/handle" or null,
  "tags": [0–4 values from TAGS, only when supported by sources],
  "note": "one short factual line, max 90 chars: what it's known for / what to order",
  "locations": integer,
  "flags": "anything uncertain, renamed, moved, closed; empty string if none",
  "sources": ["urls you used"]
}

## HOURS format (a parser reads this; follow it exactly)
- Days: Mon Tue Wed Thu Fri Sat Sun. Ranges with "-": "Mon-Fri". "Daily" for every day.
- Times: 7am, 11:30am, 5pm, noon, midnight. Range with "-": "7am-3pm". Overnight is fine: "5pm-2am".
- Split shifts on the same days: comma. "Tue-Fri 11am-2pm, 5pm-10pm"
- Separate day groups with "; ". Closed days: "Mon closed".
- Example: "Tue-Thu 5pm-9pm; Fri-Sat 11am-2pm, 5pm-10pm; Sun 11am-3pm; Mon closed"

## NEIGHBORHOODS (pick the closest; the region in brackets is for reference only)
East: East Cesar Chavez, Holly, Govalle, Chestnut, Central East Austin, Rosewood, Cherrywood, Upper Boggy Creek, MLK, Mueller, Windsor Park, Springdale, Johnston Terrace, East Riverside, Montopolis
Central: Downtown, Rainey Street, Red River, Market District, Clarksville, Old West Austin, Tarrytown, West Campus, University, North University, Hyde Park, North Loop, Rosedale
North: Allandale, Brentwood, Crestview, Wooten, North Lamar, Highland, North Shoal Creek, The Domain, Arboretum, Northwest Hills, Anderson Mill, Lakeline, Tech Ridge, Georgian Acres, St. John, Wells Branch, Jollyville, Round Rock, Cedar Park, Pflugerville, Leander
South: South Congress, Bouldin Creek, Travis Heights, Zilker, Barton Hills, South Lamar, South First, Galindo, Dawson, St. Elmo, Westgate, Sunset Valley, Manchaca, Southpark Meadows, Circle C, Oak Hill, West Lake Hills, Bee Cave
(Rule of thumb: south of Lady Bird Lake = South; east of I-35 = East, but East Riverside/Montopolis count as East.
North of ~45th St / Koenig = North. If the exact neighborhood is unclear, use the address ZIP and the nearest listed one.)

## CUISINES
Mexican, Tex-Mex, Burgers, Pizza, Italian, Fried chicken, Thai, Vietnamese, Mediterranean, Middle Eastern,
Greek, Sushi, Ramen, Japanese, Korean, Hawaiian, BBQ, Sandwiches, American, New American, Cafe, Coffee,
Bakery, Donuts, Dessert, Bagels, Seafood
(Breakfast/brunch spots: use Cafe or American/New American + tag "Brunch". Taco/burrito spots: Mexican or Tex-Mex.)

## TAGS (only when sources support it)
Date night, Cheap eats ($ and filling), Group friendly, Outdoor seating (patio), Late night (open past 11pm
most nights), Brunch (serves breakfast or weekend brunch), Solo (counter service / easy alone),
Food truck, Work friendly (coffee shop good for laptops), Dog friendly (dog-friendly patio),
Cocktails (notable cocktail program), Michelin (in the Michelin Guide Texas 2024/2025: star, Bib Gourmand or Recommended — verify)
Do NOT add a "New" tag; I handle that.
