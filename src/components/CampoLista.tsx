import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Campo digitável com lista de sugestões, no mesmo visual da lista aberta dos selects
 * (moldura arredondada, opção em azul, chevron cinza). Substitui o <datalist>, cuja lista
 * o navegador desenha do jeito dele.
 * A lista é `position: fixed` para não ser cortada por barras com rolagem; acompanha o campo ao rolar.
 */
export const CampoLista: React.FC<{
  value: string;
  onChange: (valor: string) => void;
  opcoes: string[];
  placeholder?: string;
  title?: string;
  className?: string;
}> = ({ value, onChange, opcoes, placeholder, title, className = '' }) => {
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [aberta, setAberta] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const [ativa, setAtiva] = useState(-1);

  const termo = value.trim().toLocaleLowerCase('pt-BR');
  // texto igual a uma opção (acabou de escolher): mostra todas
  const filtradas = !termo || opcoes.some((o) => o.toLocaleLowerCase('pt-BR') === termo) ? opcoes : opcoes.filter((o) => o.toLocaleLowerCase('pt-BR').includes(termo));

  const posicionar = () => {
    const r = campo.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 280) });
  };
  const abrir = () => {
    posicionar();
    setAtiva(-1);
    setAberta(true);
  };
  const escolher = (o: string) => {
    onChange(o);
    setAberta(false);
  };

  useEffect(() => {
    if (!aberta) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!campo.current?.parentElement?.contains(alvo) && !lista.current?.contains(alvo)) setAberta(false);
    };
    const rolou = (e: Event) => {
      if (!lista.current?.contains(e.target as Node)) posicionar();
    };
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', rolou);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', rolou);
    };
  }, [aberta]);

  // mantém a opção ativa visível ao navegar pelo teclado
  useEffect(() => {
    lista.current?.children[ativa]?.scrollIntoView({ block: 'nearest' });
  }, [ativa]);

  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberta) return abrir();
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      setAtiva((a) => Math.min(Math.max(a + passo, 0), filtradas.length - 1));
    } else if (e.key === 'Enter' && aberta && ativa >= 0) {
      e.preventDefault();
      escolher(filtradas[ativa]);
    } else if (e.key === 'Escape' && aberta) {
      e.stopPropagation();
      setAberta(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={campo}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!aberta) abrir();
          setAtiva(-1);
        }}
        onClick={() => (aberta ? setAberta(false) : abrir())}
        onKeyDown={teclas}
        placeholder={placeholder}
        title={title}
        autoComplete="off"
        className={`${className} !pr-7`}
      />
      <ChevronDown
        onMouseDown={(e) => {
          e.preventDefault();
          campo.current?.focus();
          aberta ? setAberta(false) : abrir();
        }}
        className={`absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-pointer transition-transform ${aberta ? 'rotate-180' : ''}`}
      />
      {aberta && filtradas.length > 0 && (
        <ul
          ref={lista}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
          className="fixed z-50 max-h-72 overflow-y-auto py-1 rounded-md border border-stone-500/20 bg-white dark:bg-stone-900 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)]"
        >
          {filtradas.map((o, i) => (
            <li
              key={o}
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(o);
              }}
              onMouseEnter={() => setAtiva(i)}
              className={`px-3 py-1.5 text-xs whitespace-nowrap cursor-pointer ${
                o === value ? 'bg-blue-600 text-white' : i === ativa ? 'bg-blue-50 dark:bg-blue-950/60 text-stone-800 dark:text-stone-100' : 'text-stone-800 dark:text-stone-100'
              }`}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
