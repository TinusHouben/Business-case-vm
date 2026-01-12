export interface Candy {
  id: string;
  name: string;
  description: string;
  pricePer100g: number; // Prijs per 100 gram
  category: string;
  image?: string;
}

export const CANDIES: Candy[] = [
  {
    id: 'CANDY001',
    name: 'Zure Matten',
    description: 'Klassieke zure matten, perfect voor de liefhebbers van zuur snoep',
    pricePer100g: 2.50,
    category: 'Zuur',
  },
  {
    id: 'CANDY002',
    name: 'Winegums',
    description: 'Zachte winegums in verschillende fruit smaken',
    pricePer100g: 2.75,
    category: 'Zacht',
  },
  {
    id: 'CANDY003',
    name: 'Dropjes',
    description: 'Traditionele Nederlandse dropjes, zout en zoet',
    pricePer100g: 2.25,
    category: 'Drop',
  },
  {
    id: 'CANDY004',
    name: 'Chocolade Hagelslag',
    description: 'Pure chocolade hagelslag voor op brood of als snack',
    pricePer100g: 3.50,
    category: 'Chocolade',
  },
  {
    id: 'CANDY005',
    name: 'Gummy Beren',
    description: 'Vrolijke gummy beren in verschillende kleuren',
    pricePer100g: 2.90,
    category: 'Zacht',
  },
  {
    id: 'CANDY006',
    name: 'Lakritz Stokjes',
    description: 'Zoute lakritz stokjes, een echte klassieker',
    pricePer100g: 2.40,
    category: 'Drop',
  },
  {
    id: 'CANDY007',
    name: 'Fruittella',
    description: 'Fruitige snoepjes met echte fruitsmaak',
    pricePer100g: 3.00,
    category: 'Fruit',
  },
  {
    id: 'CANDY008',
    name: 'Mentos',
    description: 'Verfrissende munt snoepjes',
    pricePer100g: 3.25,
    category: 'Munt',
  },
  {
    id: 'CANDY009',
    name: 'Haribo Goudberen',
    description: 'Wereldberoemde goudberen van Haribo',
    pricePer100g: 2.95,
    category: 'Zacht',
  },
  {
    id: 'CANDY010',
    name: 'Zoute Drop',
    description: 'Sterke zoute drop voor de echte drop liefhebber',
    pricePer100g: 2.30,
    category: 'Drop',
  },
  {
    id: 'CANDY011',
    name: 'Chocolade Chips',
    description: 'Kleine chocolade chips, perfect voor bakken of snacken',
    pricePer100g: 4.00,
    category: 'Chocolade',
  },
  {
    id: 'CANDY012',
    name: 'Zure Worms',
    description: 'Zure gummy worms in verschillende kleuren',
    pricePer100g: 2.80,
    category: 'Zuur',
  },
  {
    id: 'CANDY013',
    name: 'Stroopwafel Snoepjes',
    description: 'Snoepjes met de smaak van stroopwafels',
    pricePer100g: 3.50,
    category: 'Speciaal',
  },
  {
    id: 'CANDY014',
    name: 'Fruit Snacks',
    description: 'Gezonde fruit snacks zonder toegevoegde suikers',
    pricePer100g: 3.75,
    category: 'Fruit',
  },
  {
    id: 'CANDY015',
    name: 'Lollipops',
    description: 'Grote lollipops in verschillende smaken',
    pricePer100g: 2.50,
    category: 'Hard',
  },
];

export function getCandyById(id: string): Candy | undefined {
  return CANDIES.find(candy => candy.id === id);
}

export function getCandiesByCategory(category: string): Candy[] {
  return CANDIES.filter(candy => candy.category === category);
}
