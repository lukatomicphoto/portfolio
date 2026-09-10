export default {
  name: 'category',
  title: 'Kategorije sajta',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Ime kategorije (npr. SPORT - čisto da ti znaš)',
      type: 'string',
    },
    {
      name: 'order',
      title: 'Redni broj kolone (1 do 6)',
      type: 'number',
      description: 'Ovo je bitno da bi se slike učitale u pravu kolonu'
    },
    {
      name: 'coverImage',
      title: 'Glavna pozadinska fotografija',
      type: 'image',
      options: { hotspot: true },
    },
    {
      name: 'gallery',
      title: 'Galerija fotografija (samo ubaci slike)',
      type: 'array',
      of: [{ 
        type: 'image',
        options: { hotspot: true }
      }]
    }
  ],
}