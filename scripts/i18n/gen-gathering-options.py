import json
L=['en','es','de','fr','pt','ht','zh','vi','tl','ru','ko']
# each entry: key -> list of 11 strings in L order
T={}
def put(path, vals):
    assert len(vals)==11,(path,len(vals))
    T[path]=vals
put('notSpecified',['Not specified','Sin especificar','Keine Angabe','Non précisé','Não especificado','Pa presize','未指定','Chưa xác định','Hindi tinukoy','Не указано','지정 안 함'])
put('free',['Free','Gratis','Kostenlos','Gratuit','Grátis','Gratis','免费','Miễn phí','Libre','Бесплатно','무료'])
put('when.now',['Now','Ahora','Jetzt','Maintenant','Agora','Kounye a','现在','Bây giờ','Ngayon','Сейчас','지금'])
put('when.tonight',['Tonight','Esta noche','Heute Abend','Ce soir','Hoje à noite','Aswè a','今晚','Tối nay','Mamayang gabi','Сегодня вечером','오늘 밤'])
put('when.tomorrow',['Tomorrow','Mañana','Morgen','Demain','Amanhã','Demen','明天','Ngày mai','Bukas','Завтра','내일'])
put('when.custom',['Pick a Date','Elegir fecha','Datum wählen','Choisir une date','Escolher data','Chwazi yon dat','选择日期','Chọn ngày','Pumili ng Petsa','Выбрать дату','날짜 선택'])
put('repeat.none',["Doesn't repeat",'No se repite','Wiederholt sich nicht','Ne se répète pas','Não se repete','Pa repete','不重复','Không lặp lại','Hindi umuulit','Не повторяется','반복 안 함'])
put('repeat.weekly',['Weekly','Cada semana','Wöchentlich','Chaque semaine','Semanal','Chak semèn','每周','Hằng tuần','Lingguhan','Каждую неделю','매주'])
put('repeat.biweekly',['Every 2 weeks','Cada 2 semanas','Alle 2 Wochen','Toutes les 2 semaines','A cada 2 semanas','Chak 2 semèn','每两周','Mỗi 2 tuần','Tuwing 2 linggo','Раз в 2 недели','2주마다'])
put('repeat.monthly',['Monthly','Cada mes','Monatlich','Chaque mois','Mensal','Chak mwa','每月','Hằng tháng','Buwanan','Каждый месяц','매월'])
put('kind.friends',['👥 Friends / casual hangout','👥 Amigos / plan casual','👥 Freunde / lockeres Treffen','👥 Amis / moment détente','👥 Amigos / encontro casual','👥 Zanmi / rankont tou senp','👥 朋友 / 轻松小聚','👥 Bạn bè / gặp gỡ thoải mái','👥 Mga kaibigan / tambayan','👥 Друзья / просто посидеть','👥 친구 / 가벼운 만남'])
put('kind.date',['💕 Date','💕 Cita','💕 Date','💕 Rendez-vous','💕 Encontro romântico','💕 Randevou','💕 约会','💕 Hẹn hò','💕 Date','💕 Свидание','💕 데이트'])
put('kind.family',['👨‍👩‍👧 Family','👨‍👩‍👧 Familia','👨‍👩‍👧 Familie','👨‍👩‍👧 Famille','👨‍👩‍👧 Família','👨‍👩‍👧 Fanmi','👨‍👩‍👧 家庭','👨‍👩‍👧 Gia đình','👨‍👩‍👧 Pamilya','👨‍👩‍👧 Семья','👨‍👩‍👧 가족'])
put('kind.coworkers',['💼 Networking / work','💼 Networking / trabajo','💼 Networking / Arbeit','💼 Réseautage / travail','💼 Networking / trabalho','💼 Rezo / travay','💼 社交 / 工作','💼 Kết nối / công việc','💼 Networking / trabaho','💼 Нетворкинг / работа','💼 네트워킹 / 업무'])
put('kind.new_people',['🤝 Meet new people','🤝 Conocer gente nueva','🤝 Neue Leute kennenlernen','🤝 Rencontrer du monde','🤝 Conhecer gente nova','🤝 Rankontre nouvo moun','🤝 认识新朋友','🤝 Làm quen người mới','🤝 Makakilala ng bagong tao','🤝 Новые знакомства','🤝 새로운 사람 만나기'])
put('kind.groups',['👨‍👩‍👧‍👦 Big group','👨‍👩‍👧‍👦 Grupo grande','👨‍👩‍👧‍👦 Große Gruppe','👨‍👩‍👧‍👦 Grand groupe','👨‍👩‍👧‍👦 Grupo grande','👨‍👩‍👧‍👦 Gwo gwoup','👨‍👩‍👧‍👦 大团体','👨‍👩‍👧‍👦 Nhóm đông','👨‍👩‍👧‍👦 Malaking grupo','👨‍👩‍👧‍👦 Большая компания','👨‍👩‍👧‍👦 큰 그룹'])
put('kind.solo',['🧍 Solo-friendly','🧍 Para ir solo','🧍 Auch allein','🧍 Seul, c’est bien aussi','🧍 Dá para ir sozinho','🧍 Bon pou ale pou kont ou','🧍 适合独自参加','🧍 Đi một mình cũng được','🧍 Puwedeng mag-isa','🧍 Можно одному','🧍 혼자도 좋아요'])
put('capacity.no_limit',['No Limit','Sin límite','Keine Grenze','Sans limite','Sem limite','San limit','不限人数','Không giới hạn','Walang limit','Без ограничений','제한 없음'])
put('capacity.2-4',['2-4 people','2-4 personas','2-4 Personen','2 à 4 personnes','2-4 pessoas','2-4 moun','2-4 人','2-4 người','2-4 tao','2-4 человека','2~4명'])
put('capacity.5-10',['5-10 people','5-10 personas','5-10 Personen','5 à 10 personnes','5-10 pessoas','5-10 moun','5-10 人','5-10 người','5-10 tao','5-10 человек','5~10명'])
put('capacity.10+',['10+ people','10+ personas','10+ Personen','10 personnes et plus','10+ pessoas','10+ moun','10 人以上','10+ người','10+ tao','10+ человек','10명 이상'])
put('feature.wheelchair_accessible',['Wheelchair accessible','Accesible en silla de ruedas','Rollstuhlgerecht','Accessible en fauteuil roulant','Acessível para cadeira de rodas','Aksesib pou chèz woulant','无障碍轮椅通行','Có lối cho xe lăn','Accessible sa wheelchair','Доступно для колясок','휠체어 접근 가능'])
put('feature.accessible_parking',['Accessible parking','Estacionamiento accesible','Behindertenparkplatz','Stationnement accessible','Estacionamento acessível','Pakin aksesib','无障碍停车位','Chỗ đậu xe cho người khuyết tật','Accessible na paradahan','Доступная парковка','장애인 주차'])
put('feature.accessible_restroom',['Accessible restroom','Baño accesible','Barrierefreie Toilette','Toilettes accessibles','Banheiro acessível','Twalèt aksesib','无障碍洗手间','Nhà vệ sinh cho người khuyết tật','Accessible na banyo','Доступный туалет','장애인 화장실'])
put('feature.service_animal_friendly',['Service animal friendly','Se admiten animales de servicio','Assistenztiere willkommen','Animaux d’assistance acceptés','Aceita animais de serviço','Bèt sèvis akseptab','可带服务动物','Chấp nhận động vật hỗ trợ','Puwede ang service animal','Можно с собакой-помощником','보조견 동반 가능'])
put('feature.quiet',['Quiet environment','Ambiente tranquilo','Ruhige Umgebung','Environnement calme','Ambiente tranquilo','Anviwònman trankil','安静的环境','Không gian yên tĩnh','Tahimik na lugar','Тихая обстановка','조용한 환경'])
put('feature.kid_friendly',['Kids welcome','Niños bienvenidos','Kinder willkommen','Enfants bienvenus','Crianças bem-vindas','Timoun byenveni','欢迎儿童','Chào đón trẻ em','Welcome ang mga bata','Можно с детьми','아이 환영'])
put('feature.stroller_friendly',['Stroller friendly','Apto para carriolas','Kinderwagenfreundlich','Accessible en poussette','Acessível para carrinho de bebê','Bon pou pousèt','方便婴儿车','Thuận tiện xe đẩy','Puwede ang stroller','Удобно с коляской','유모차 이용 편리'])
put('feature.family_seating',['Family seating','Mesas para familias','Familienplätze','Places pour les familles','Lugares para famílias','Plas pou fanmi','家庭座位','Chỗ ngồi gia đình','Upuan para sa pamilya','Места для семей','가족 좌석'])
put('feature.outdoor_seating',['Outdoor seating','Mesas al aire libre','Sitzplätze draußen','Places en extérieur','Mesas ao ar livre','Plas deyò','户外座位','Chỗ ngồi ngoài trời','Upuan sa labas','Места на улице','야외 좌석'])
put('equipment.provided',['Equipment provided','Se incluye el equipo','Ausrüstung wird gestellt','Équipement fourni','Equipamento fornecido','Yo bay ekipman','提供装备','Có cung cấp dụng cụ','May ibibigay na gamit','Снаряжение предоставляется','장비 제공'])
put('equipment.byo',['Bring your own','Trae el tuyo','Selbst mitbringen','Apportez le vôtre','Traga o seu','Pote pa w','自带','Tự mang theo','Magdala ng sarili','Приносите своё','개인 지참'])
put('duration.30',['30 min','30 min','30 Min.','30 min','30 min','30 min','30 分钟','30 phút','30 min','30 мин','30분'])
put('duration.60',['1 hr','1 h','1 Std.','1 h','1 h','1 è','1 小时','1 giờ','1 oras','1 ч','1시간'])
put('duration.90',['1.5 hr','1,5 h','1,5 Std.','1 h 30','1,5 h','1,5 è','1.5 小时','1,5 giờ','1.5 oras','1,5 ч','1시간 30분'])
put('duration.120',['2 hr','2 h','2 Std.','2 h','2 h','2 è','2 小时','2 giờ','2 oras','2 ч','2시간'])
put('duration.180',['3 hr','3 h','3 Std.','3 h','3 h','3 è','3 小时','3 giờ','3 oras','3 ч','3시간'])
G=[('rock','Rock'),('pop','Pop'),('jazz','Jazz'),('blues','Blues'),('country','Country'),('hip_hop','Hip-Hop'),('electronic','Electronic'),('techno','Techno'),('classical','Classical'),('folk','Folk'),('latin','Latin'),('r_and_b','R&B'),('open_mic','Open Mic')]
gtr={'electronic':['Electronic','Electrónica','Elektronisch','Électronique','Eletrônica','Elektwonik','电子','Điện tử','Electronic','Электроника','일렉트로닉'],
 'classical':['Classical','Clásica','Klassik','Classique','Clássica','Klasik','古典','Cổ điển','Classical','Классика','클래식'],
 'folk':['Folk','Folk','Folk','Folk','Folk','Folk','民谣','Dân gian','Folk','Фолк','포크'],
 'latin':['Latin','Latina','Latin','Latino','Latina','Laten','拉丁','Latin','Latin','Латино','라틴'],
 'country':['Country','Country','Country','Country','Country','Country','乡村','Đồng quê','Country','Кантри','컨트리'],
 'open_mic':['Open Mic','Micrófono abierto','Open Mic','Scène ouverte','Microfone aberto','Mikwo louvri','开放麦','Open Mic','Open Mic','Открытый микрофон','오픈 마이크'],
 'rock':['Rock','Rock','Rock','Rock','Rock','Wòk','摇滚','Rock','Rock','Рок','록'],
 'pop':['Pop','Pop','Pop','Pop','Pop','Pòp','流行','Pop','Pop','Поп','팝'],
 'jazz':['Jazz','Jazz','Jazz','Jazz','Jazz','Djaz','爵士','Jazz','Jazz','Джаз','재즈'],
 'blues':['Blues','Blues','Blues','Blues','Blues','Blouz','蓝调','Blues','Blues','Блюз','블루스'],
 'hip_hop':['Hip-Hop','Hip-hop','Hip-Hop','Hip-hop','Hip-hop','Hip-hop','嘻哈','Hip-hop','Hip-Hop','Хип-хоп','힙합'],
 'techno':['Techno','Techno','Techno','Techno','Techno','Tekno','Techno','Techno','Techno','Техно','테크노'],
 'r_and_b':['R&B','R&B','R&B','R&B','R&B','R&B','节奏布鲁斯','R&B','R&B','R&B','R&B'],
}
for k,_ in G: put('genre.'+k, gtr[k])
F={'drop_in':['Drop-in','Llega cuando quieras','Offen für alle','Passage libre','Passe quando quiser','Vin lè w vle','随到随参加','Ghé lúc nào cũng được','Drop-in','Свободный вход','자유 참여'],
 'class':['Class','Clase','Kurs','Cours','Aula','Kou','课程','Lớp học','Klase','Занятие','수업'],
 'tournament':['Tournament','Torneo','Turnier','Tournoi','Torneio','Tounwa','锦标赛','Giải đấu','Torneo','Турнир','토너먼트'],
 'meetup':['Meetup','Encuentro','Meetup','Rencontre','Encontro','Rankont','见面会','Buổi gặp gỡ','Meetup','Встреча','밋업'],
 'concert':['Concert','Concierto','Konzert','Concert','Show','Konsè','音乐会','Hòa nhạc','Konsiyerto','Концерт','콘서트'],
 'show':['Show','Espectáculo','Show','Spectacle','Espetáculo','Espektak','演出','Buổi biểu diễn','Palabas','Шоу','공연'],
 'festival':['Festival','Festival','Festival','Festival','Festival','Festival','节日活动','Lễ hội','Pista','Фестиваль','페스티벌'],
 'tour':['Tour','Recorrido','Führung','Visite','Passeio guiado','Vizit','导览','Tham quan','Tour','Экскурсия','투어'],
 'workshop':['Workshop','Taller','Workshop','Atelier','Oficina','Atelye','工作坊','Hội thảo thực hành','Workshop','Мастер-класс','워크숍'],
 'appointment':['Appointment','Cita','Termin','Rendez-vous','Horário marcado','Randevou','预约','Lịch hẹn','Appointment','Запись','예약 방문'],
 'reservation':['Reservation','Reserva','Reservierung','Réservation','Reserva','Rezèvasyon','订位','Đặt chỗ','Reserbasyon','Бронирование','예약'],
 'open_play':['Open play','Juego libre','Freies Spiel','Jeu libre','Jogo livre','Jwe lib','自由参与','Chơi tự do','Open play','Свободная игра','자유 게임'],
 'competition':['Competition','Competencia','Wettbewerb','Compétition','Competição','Konpetisyon','比赛','Cuộc thi','Kompetisyon','Соревнование','대회'],
 'exhibition':['Exhibition','Exposición','Ausstellung','Exposition','Exposição','Ekspozisyon','展览','Triển lãm','Eksibisyon','Выставка','전시'],
 'market':['Market','Mercado','Markt','Marché','Feira','Mache','市集','Chợ phiên','Palengke','Рынок','마켓'],
 'party':['Party','Fiesta','Party','Fête','Festa','Fèt','派对','Tiệc','Party','Вечеринка','파티'],
}
for k,v in F.items(): put('format.'+k, v)
S={'beginner':['Beginner','Principiante','Anfänger','Débutant','Iniciante','Debitan','初学者','Người mới','Baguhan','Новичок','초급'],
 'intermediate':['Intermediate','Intermedio','Fortgeschritten','Intermédiaire','Intermediário','Mwayen','中级','Trung cấp','Intermediate','Средний','중급'],
 'advanced':['Advanced','Avanzado','Experte','Avancé','Avançado','Avanse','高级','Nâng cao','Advanced','Продвинутый','고급'],
 'all_levels':['All levels','Todos los niveles','Alle Niveaus','Tous niveaux','Todos os níveis','Tout nivo','所有水平','Mọi trình độ','Lahat ng antas','Любой уровень','모든 수준'],
 'casual':['Casual','Casual','Locker','Détente','Casual','Pou plezi','休闲','Vui là chính','Casual','Для удовольствия','캐주얼'],
 'competitive':['Competitive','Competitivo','Wettkampf','Compétitif','Competitivo','Konpetitif','竞技','Thi đấu','Competitive','Соревновательный','경쟁'],
}
for k,v in S.items(): put('skill.'+k, v)
E={'light':['Light','Ligero','Leicht','Léger','Leve','Lejè','轻松','Nhẹ','Magaan','Лёгкая','가벼움'],
 'moderate':['Moderate','Moderado','Mittel','Modéré','Moderado','Mwayen','适中','Vừa phải','Katamtaman','Средняя','보통'],
 'challenging':['Challenging','Exigente','Anspruchsvoll','Exigeant','Desafiador','Difisil','有挑战','Thử thách','Mahirap','Сложная','도전적'],
}
for k,v in E.items(): put('effort.'+k, v)
out={l:{} for l in L}
for path,vals in T.items():
    parts=path.split('.')
    for i,l in enumerate(L):
        d=out[l]
        for p in parts[:-1]: d=d.setdefault(p,{})
        d[parts[-1]]=vals[i]
src="// Option labels for the gathering fields shared by Create and Edit (localization pass 5). Keys = the stored values of the\n// source lists (whenPresets, gatheringPractical, activityFormat, skillLevel, intensityEffort, CreateGathering's plan kinds and\n// capacity buckets); gatheringOptions.test.js keeps them equal. Display only. Machine-authored outside English; needs review.\n// Generated by scripts/i18n/gen-gathering-options.py -- edit there, not here.\nexport default "+json.dumps(out,ensure_ascii=False,indent=2)+";\n"
open('/workspaces/Nearby/src/i18n/ui/gatheringOptions.js','w').write(src)
