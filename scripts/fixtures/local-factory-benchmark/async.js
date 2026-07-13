export async function saveAll(records, store) {
  records.forEach(record => store.save(record))
  return { saved: records.length }
}
