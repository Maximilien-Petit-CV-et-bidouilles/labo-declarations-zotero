exports.handler = async (event) => {
  const p = JSON.parse(event.body);
  const apiKey = process.env.ZOTERO_API_KEY;
  const libType = process.env.ZOTERO_LIBRARY_TYPE;
  const libId = process.env.ZOTERO_LIBRARY_ID;

  const creators = p.authors.map(a => ({
    creatorType:'author',
    firstName:a.firstName||'',
    lastName:a.lastName||''
  }));

  const item = p.pubType === 'book'
    ? {
        itemType:'book',
        title:p.title,
        creators,
        date:p.date,
        publisher:p.publisher,
        place:p.place,
        ISBN:p.isbn||'',
        abstractNote:p.abstract||'',
        language:p.language||'',
        extra:p.extra||''
      }
    : {
        itemType:'bookSection',
        title:p.title,
        creators,
        bookTitle:p.bookTitle,
        series:p.series||'',
        seriesNumber:p.seriesNumber||'',
        volume:p.volume||'',
        edition:p.edition||'',
        date:p.date,
        publisher:p.publisher,
        place:p.place,
        pages:p.pages||'',
        ISBN:p.isbn||'',
        extra:p.extra||''
      };

  const r = await fetch(`https://api.zotero.org/${libType}/${libId}/items`, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Zotero-API-Key':apiKey,
      'Zotero-API-Version':'3'
    },
    body:JSON.stringify([item])
  });

  return { statusCode:r.status, body:await r.text() };
};
