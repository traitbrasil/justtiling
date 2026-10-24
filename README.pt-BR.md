<p align="center">
  <img src="docs/assets/justtiling-banner.svg" alt="Trait JustTiling — organização automática de janelas para GNOME" width="100%">
</p>

<p align="center">
  <strong>Janelas organizadas. Mais espaço para se concentrar.</strong><br>
  Organização automática, layouts flexíveis e destaque de foco no seu desktop GNOME.
</p>

<p align="center">
  <a href="https://trait.li/just">Site</a> ·
  <a href="docs/README.md">Documentação</a> ·
  <a href="https://github.com/traitbrasil/justtiling/issues">Reportar um problema</a> ·
  <a href="README.md">English</a>
</p>

---

**GNOME Shell 51** · **Um monitor** · **Inglês e português** · **GPL-3.0-or-later**

A Trait JustTiling organiza suas janelas conforme você abre e fecha aplicativos, com um layout independente por workspace. Ajuste uma divisão, troque duas janelas ou mantenha um aplicativo flutuante. Você escolhe como trabalhar.

**Versão atual: 0.26.1.** Em preparação para a primeira submissão ao GNOME Extensions. A instalação está disponível pelo código-fonte.

## Um espaço que acompanha seu trabalho

- **Organização automática:** novas janelas encontram espaço; ao fechar uma janela, as demais aproveitam a área disponível.
- **Layout do seu jeito:** redimensione divisões, troque janelas por arraste ou teclado e escolha o lado de abertura.
- **Janelas equilibradas:** distribua o espaço entre janelas sem preferência, com prioridade para posições e tamanhos fixados ou aprendidos.
- **Aprendizado local:** seus ajustes manuais de tamanho e posição orientam a abertura futura de aplicativos. Ativado por padrão, pode ser pausado ou apagado por aplicativo ou por completo.
- **Liberdade para flutuar:** janelas incompatíveis ficam fora do grid. Defina também os aplicativos que devem permanecer flutuantes.
- **Prévia da troca:** ao arrastar, um overlay semitransparente na cor de destaque do GNOME indica a janela que receberá o swap.
- **Destaque visual:** borda opcional na cor de destaque do GNOME.
- **Cantos arredondados:** opção para arredondar janelas organizadas e flutuantes em harmonia com a borda de foco.
- **Preferências nativas:** personalize espaçamentos, atalhos e comportamento sem editar arquivos.

O aprendizado considera o espaço e as restrições das janelas. Ele não garante a reprodução exata de um grid, e ignora aplicativos com múltiplas janelas organizadas.

## Instalar

Requer **GNOME Shell 51**, um monitor lógico e as ferramentas `git`, `make`, `gjs`, `python3` e `glib-compile-schemas`.

```bash
git clone https://github.com/traitbrasil/justtiling.git
cd justtiling
make package
gnome-extensions install --force dist/trait-justtiling-0.26.1.zip
```

**Encerre e inicie a sessão novamente.** Depois:

```bash
gnome-extensions enable justtiling@trait.com.br
gnome-extensions prefs justtiling@trait.com.br
```

Os guias detalhados estão em inglês: [instalação e atualização](docs/installation.md), [uso diário](docs/user-guide.md) e [configuração](docs/configuration.md).

## Atalhos padrão

| Atalho | Ação |
| --- | --- |
| **Super + T** | Ligar ou desligar a organização automática |
| **Super + G** | Alternar a janela ativa entre organizada e flutuante |
| **Super + Y** | Fixar ou desafixar o aplicativo ativo |
| **Super + F** | Alternar o foco entre janelas organizadas |
| **Super + C** | Trocar com uma janela numerada; Esc ou repetir o atalho cancela |
| **Super + ← / → / ↑ / ↓** | Trocar a janela ativa com a vizinha |

As nove ações são configuráveis nas Preferências. Super+setas substitui temporariamente os atalhos conflitantes do GNOME enquanto a organização está ativa; eles são restaurados quando a gestão é interrompida.

## Compatibilidade e privacidade

Esta versão é voltada a **GNOME Shell 51 com um monitor lógico**. Um segundo monitor pausa a organização e solicita a restauração das janelas. Ao voltar a um monitor, retome pelo menu ou atalho. Outras versões do GNOME e organização em múltiplos monitores não fazem parte do suporte atual.

A interface acompanha o idioma da sessão: português em sessões em português, inglês nos demais idiomas. O aprendizado fica salvo localmente em GSettings. Não há requisições de rede em segundo plano; os links do Sobre só abrem por ação do usuário e incluem parâmetros fixos de campanha.

## Participe

Consulte a [documentação](docs/README.md) e o [guia de contribuição](CONTRIBUTING.md). Para problemas ou ideias, abra uma [issue](https://github.com/traitbrasil/justtiling/issues).

Criado por **[Dudu Broering](https://trait.li/dudu)** na **[Trait](https://www.trait.com.br/)**. Conheça o **[Trait Just](https://trait.li/just)** ou entre em contato: **[just@trait.com.br](mailto:just@trait.com.br)**.

Código aberto sob [GPL-3.0-or-later](LICENSE).
