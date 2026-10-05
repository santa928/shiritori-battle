export const source={id:'fixture',version:'1',url:'https://example.invalid',license:'TEST',sha256:'a'.repeat(64)};
export const sense=(id,extra={})=>({id,pos:['noun'],labels:[],definitions:[{language:'ja',text:'テスト専用の意味'}],...extra});
export const entry=(id,readings=['かな'],senses=[sense('1')])=>({id,spellings:[id],readings,senses,sourceId:source.id,sourceUrl:'https://example.invalid/'+encodeURIComponent(id)});
export const dataset=(entries=[])=>({schemaVersion:1,sources:[source],entries});
