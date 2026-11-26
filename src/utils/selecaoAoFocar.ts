/**
 * Ao entrar num campo de digitação, todo o conteúdo fica selecionado: o que o
 * usuário digitar substitui o valor, sem precisar apagar antes.
 *
 * Instalado uma vez para o documento inteiro (main.tsx), então vale para qualquer
 * campo, inclusive os que forem criados depois.
 *
 * Ficam de fora:
 *  - áreas de texto (textarea: observações, JSON). Nelas o usuário costuma clicar
 *    para acrescentar algo no meio, e selecionar tudo faria a primeira tecla apagar
 *    o texto inteiro;
 *  - controles que não são de digitação (checkbox, arquivo, cor, data nativa etc.).
 */

const TIPOS_DIGITACAO = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number', '']);

function ehCampoDeDigitacao(el: EventTarget | null): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    TIPOS_DIGITACAO.has(el.type) &&
    !el.readOnly &&
    !el.disabled
  );
}

export function instalarSelecaoAoFocar() {
  // Campo que acabou de ganhar foco por clique: o mouseup desse clique desfaria a seleção
  let focadoPorClique: HTMLInputElement | null = null;
  // Campo que já recebeu um clique desde que ganhou o foco. O primeiro clique num campo
  // focado pelo sistema (autoFocus, Tab) também conta como "entrar" e seleciona tudo;
  // os cliques seguintes posicionam o cursor normalmente.
  let clicadoDesdeFoco: HTMLInputElement | null = null;

  document.addEventListener('mousedown', (e) => {
    const alvo = e.target;
    focadoPorClique = ehCampoDeDigitacao(alvo) && clicadoDesdeFoco !== alvo ? alvo : null;
    if (ehCampoDeDigitacao(alvo)) clicadoDesdeFoco = alvo;
  });

  document.addEventListener('focusin', (e) => {
    const alvo = e.target;
    // foco vindo de clique: esse clique já conta; foco pelo sistema (autoFocus, Tab): ainda não
    clicadoDesdeFoco = alvo === focadoPorClique ? focadoPorClique : null;
    if (!ehCampoDeDigitacao(alvo)) return;
    try {
      alvo.select();
    } catch {
      // alguns tipos não suportam seleção; ignorado
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (focadoPorClique && e.target === focadoPorClique) {
      // Mantém a seleção feita no focusin (ou seleciona, se o campo já estava focado)
      e.preventDefault();
      try {
        focadoPorClique.select();
      } catch {
        // ignorado
      }
    }
    focadoPorClique = null;
  });
}
