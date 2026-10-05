/**
 * 最新の検索だけを通知する。IME変換中の送信とdestroy後・古い応答の通知を無視する。
 * @param {{search: function(string): Promise<object>}} client 辞書検索の窓口。
 * @param {function(object): void} onState loading/result/errorの通知先。
 * @returns {{submit: function(string, object=): Promise<void>, destroy: function(): void}} 検索と通知停止。
 */
export function createSearchController(client, onState) {
  let sequence = 0,
    active = true;
  return {
    async submit(input, { isComposing = false } = {}) {
      if (isComposing || !active) return;
      const token = ++sequence;
      onState({ phase: 'loading' });
      try {
        const result = await client.search(input);
        if (active && token === sequence) onState({ phase: 'result', result });
      } catch (error) {
        if (active && token === sequence) onState({ phase: 'error', error });
      }
    },
    destroy() {
      active = false;
      sequence++;
    },
  };
}
