// Gathering vocabulary shared by GatheringDetail, Create and Edit: who can see a gathering (visibility.<key>, the keys of
// constants/gatheringVisibility.js VISIBILITY_OPTIONS) and the host's vibe scales (vibe.<gatherings column>). Display only;
// the stored values are the keys. Machine-authored outside English; needs native-speaker review.
export default {
  en: {
    visibility: {
      invite_only: { label: 'Invite Only', hint: "Only people you personally invite — you'll approve each person" },
      friends: { label: 'Friends', hint: 'Only your friends can find this' },
      community: { label: 'Community', hint: 'Only members of one of your communities' },
      everyone: { label: 'Everyone', hint: 'Anyone nearby can discover this' },
    },
    vibe: {
      energy_level: { label: 'Energy', low: 'Chill', high: 'High energy' },
      conversation_level: { label: 'Conversation', low: 'Quiet', high: 'Chatty' },
      group_size_feel: { label: 'Group feel', low: 'Intimate', high: 'Big group' },
    },
  },
  es: {
    visibility: {
      invite_only: { label: 'Solo con invitación', hint: 'Solo las personas que invites tú — aprobarás a cada una' },
      friends: { label: 'Amigos', hint: 'Solo tus amigos pueden encontrarla' },
      community: { label: 'Comunidad', hint: 'Solo miembros de una de tus comunidades' },
      everyone: { label: 'Todos', hint: 'Cualquiera cerca puede descubrirla' },
    },
    vibe: {
      energy_level: { label: 'Energía', low: 'Tranquila', high: 'Mucha energía' },
      conversation_level: { label: 'Conversación', low: 'Silenciosa', high: 'Conversadora' },
      group_size_feel: { label: 'Tamaño del grupo', low: 'Íntimo', high: 'Grupo grande' },
    },
  },
  de: {
    visibility: {
      invite_only: { label: 'Nur mit Einladung', hint: 'Nur Leute, die du persönlich einlädst — du bestätigst jede Person' },
      friends: { label: 'Freunde', hint: 'Nur deine Freunde können es finden' },
      community: { label: 'Community', hint: 'Nur Mitglieder einer deiner Communitys' },
      everyone: { label: 'Alle', hint: 'Jeder in der Nähe kann es entdecken' },
    },
    vibe: {
      energy_level: { label: 'Energie', low: 'Entspannt', high: 'Viel Energie' },
      conversation_level: { label: 'Gespräch', low: 'Ruhig', high: 'Gesprächig' },
      group_size_feel: { label: 'Gruppengefühl', low: 'Intim', high: 'Große Gruppe' },
    },
  },
  fr: {
    visibility: {
      invite_only: { label: 'Sur invitation', hint: 'Seulement les personnes que vous invitez — vous approuvez chacune' },
      friends: { label: 'Amis', hint: 'Seuls vos amis peuvent la trouver' },
      community: { label: 'Communauté', hint: "Seulement les membres d'une de vos communautés" },
      everyone: { label: 'Tout le monde', hint: 'Toute personne à proximité peut la découvrir' },
    },
    vibe: {
      energy_level: { label: 'Énergie', low: 'Tranquille', high: 'Pleine énergie' },
      conversation_level: { label: 'Discussion', low: 'Calme', high: 'Bavard' },
      group_size_feel: { label: 'Taille du groupe', low: 'Intime', high: 'Grand groupe' },
    },
  },
  pt: {
    visibility: {
      invite_only: { label: 'Só com convite', hint: 'Só quem você convidar pessoalmente — você aprova cada pessoa' },
      friends: { label: 'Amigos', hint: 'Só seus amigos podem encontrar' },
      community: { label: 'Comunidade', hint: 'Só membros de uma das suas comunidades' },
      everyone: { label: 'Todos', hint: 'Qualquer pessoa por perto pode descobrir' },
    },
    vibe: {
      energy_level: { label: 'Energia', low: 'Tranquilo', high: 'Muita energia' },
      conversation_level: { label: 'Conversa', low: 'Silencioso', high: 'Muito papo' },
      group_size_feel: { label: 'Sensação de grupo', low: 'Íntimo', high: 'Grupo grande' },
    },
  },
  ht: {
    visibility: {
      invite_only: { label: 'Sou envitasyon sèlman', hint: 'Sèlman moun ou envite pèsonèlman — w ap apwouve chak moun' },
      friends: { label: 'Zanmi', hint: 'Se zanmi w sèlman ki ka jwenn li' },
      community: { label: 'Kominote', hint: 'Sèlman manm youn nan kominote ou yo' },
      everyone: { label: 'Tout moun', hint: 'Nenpòt moun toupre ka dekouvri l' },
    },
    vibe: {
      energy_level: { label: 'Enèji', low: 'Kalm', high: 'Anpil enèji' },
      conversation_level: { label: 'Konvèsasyon', low: 'Trankil', high: 'Anpil pale' },
      group_size_feel: { label: 'Gwosè gwoup', low: 'Entim', high: 'Gwo gwoup' },
    },
  },
  zh: {
    visibility: {
      invite_only: { label: '仅限邀请', hint: '只有你亲自邀请的人 — 每个人都需要你批准' },
      friends: { label: '朋友', hint: '只有你的朋友能找到' },
      community: { label: '社群', hint: '仅限你某个社群的成员' },
      everyone: { label: '所有人', hint: '附近任何人都能发现' },
    },
    vibe: {
      energy_level: { label: '活力', low: '轻松', high: '活力满满' },
      conversation_level: { label: '聊天', low: '安静', high: '健谈' },
      group_size_feel: { label: '团体感', low: '小而亲密', high: '大团体' },
    },
  },
  vi: {
    visibility: {
      invite_only: { label: 'Chỉ khi được mời', hint: 'Chỉ những người bạn trực tiếp mời — bạn sẽ duyệt từng người' },
      friends: { label: 'Bạn bè', hint: 'Chỉ bạn bè của bạn mới tìm thấy' },
      community: { label: 'Cộng đồng', hint: 'Chỉ thành viên của một cộng đồng của bạn' },
      everyone: { label: 'Mọi người', hint: 'Bất kỳ ai gần đây đều có thể khám phá' },
    },
    vibe: {
      energy_level: { label: 'Năng lượng', low: 'Thư giãn', high: 'Sôi động' },
      conversation_level: { label: 'Trò chuyện', low: 'Yên tĩnh', high: 'Rôm rả' },
      group_size_feel: { label: 'Cảm giác nhóm', low: 'Thân mật', high: 'Nhóm đông' },
    },
  },
  tl: {
    visibility: {
      invite_only: { label: 'Imbitasyon Lang', hint: 'Mga taong personal mong inimbita lang — aaprubahan mo ang bawat isa' },
      friends: { label: 'Mga Kaibigan', hint: 'Mga kaibigan mo lang ang makakakita' },
      community: { label: 'Komunidad', hint: 'Mga miyembro lang ng isa sa mga komunidad mo' },
      everyone: { label: 'Lahat', hint: 'Kahit sino sa malapit ay puwedeng makatuklas nito' },
    },
    vibe: {
      energy_level: { label: 'Enerhiya', low: 'Chill', high: 'Mataas ang enerhiya' },
      conversation_level: { label: 'Kuwentuhan', low: 'Tahimik', high: 'Madaldal' },
      group_size_feel: { label: 'Pakiramdam ng grupo', low: 'Malapitan', high: 'Malaking grupo' },
    },
  },
  ru: {
    visibility: {
      invite_only: { label: 'Только по приглашению', hint: 'Только те, кого вы пригласите лично — каждого вы одобряете сами' },
      friends: { label: 'Друзья', hint: 'Найти могут только ваши друзья' },
      community: { label: 'Сообщество', hint: 'Только участники одного из ваших сообществ' },
      everyone: { label: 'Все', hint: 'Любой рядом может это найти' },
    },
    vibe: {
      energy_level: { label: 'Энергия', low: 'Спокойно', high: 'Много энергии' },
      conversation_level: { label: 'Общение', low: 'Тихо', high: 'Разговорчиво' },
      group_size_feel: { label: 'Ощущение группы', low: 'Камерно', high: 'Большая компания' },
    },
  },
  ko: {
    visibility: {
      invite_only: { label: '초대 전용', hint: '직접 초대한 사람만 — 한 명씩 승인해요' },
      friends: { label: '친구', hint: '친구만 찾을 수 있어요' },
      community: { label: '커뮤니티', hint: '내 커뮤니티 중 한 곳의 멤버만' },
      everyone: { label: '모두', hint: '근처의 누구나 찾을 수 있어요' },
    },
    vibe: {
      energy_level: { label: '에너지', low: '여유로움', high: '에너지 넘침' },
      conversation_level: { label: '대화', low: '조용함', high: '수다스러움' },
      group_size_feel: { label: '그룹 분위기', low: '아늑함', high: '큰 그룹' },
    },
  },
};
