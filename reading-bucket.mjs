/** Identical UTF-8 bucket mapping in Node and browsers; input is already normalized. */
export async function bucketForReading(reading){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reading));
  return new Uint8Array(digest)[0].toString(16).padStart(2,'0');
}
