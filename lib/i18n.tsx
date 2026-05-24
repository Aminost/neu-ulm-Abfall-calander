import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { I18nManager } from "react-native";
import { storage } from "./storage";

export type Language = "de" | "en" | "tr" | "ar" | "fr" | "hi" | "es" | "ru";

const SUPPORTED_LANGUAGES: Language[] = ["de", "en", "tr", "ar", "fr", "hi", "es", "ru"];

type TranslationMap = Record<string, Record<Language, string>>;

const translations: TranslationMap = {
  // ── Navigation ─────────────────────────────────────────────────────────────
  home:     { de: "Home",          en: "Home",       tr: "Ana Sayfa", ar: "الرئيسية",   fr: "Accueil",    hi: "होम",        es: "Inicio",  ru: "Главная" },
  map:      { de: "Karte",         en: "Map",         tr: "Harita",    ar: "الخريطة",    fr: "Carte",      hi: "नक्शा",      es: "Mapa",    ru: "Карта" },
  settings: { de: "Einstellungen", en: "Settings",    tr: "Ayarlar",   ar: "الإعدادات",  fr: "Paramètres", hi: "सेटिंग्स",  es: "Ajustes", ru: "Настройки" },

  // ── Home ───────────────────────────────────────────────────────────────────
  calendarTitle:     { de: "Müllkalender",                en: "Waste Calendar",           tr: "Çöp Takvimi",         ar: "تقويم النفايات",              fr: "Calendrier des déchets",     hi: "अपशिष्ट कैलेंडर",       es: "Calendario de residuos",      ru: "Календарь отходов" },
  nextPickup:        { de: "Nächste Abholung",             en: "Next Pickup",              tr: "Sonraki Toplama",     ar: "الجمع القادم",                fr: "Prochaine collecte",         hi: "अगला पिकअप",            es: "Próxima recogida",            ru: "Следующий вывоз" },
  today:             { de: "Heute",                        en: "Today",                    tr: "Bugün",               ar: "اليوم",                       fr: "Aujourd'hui",                hi: "आज",                    es: "Hoy",                         ru: "Сегодня" },
  tomorrow:          { de: "Morgen",                       en: "Tomorrow",                 tr: "Yarın",               ar: "غداً",                        fr: "Demain",                     hi: "कल",                    es: "Mañana",                      ru: "Завтра" },
  inDays:            { de: "In {days} Tagen",              en: "In {days} days",           tr: "{days} gün içinde",   ar: "خلال {days} أيام",            fr: "Dans {days} jours",          hi: "{days} दिनों में",      es: "En {days} días",              ru: "Через {days} дней" },
  upcoming:          { de: "Demnächst",                    en: "Upcoming",                 tr: "Yaklaşanlar",         ar: "قريباً",                      fr: "À venir",                    hi: "आगामी",                 es: "Próximamente",                ru: "Предстоящие" },
  noPickups:         { de: "Keine Abholungen an diesem Tag.", en: "No pickups on this day.", tr: "Bu gün için toplama yok.", ar: "لا توجد عمليات جمع في هذا اليوم.", fr: "Aucune collecte ce jour-là.", hi: "इस दिन कोई पिकअप नहीं।", es: "No hay recogidas este día.", ru: "В этот день вывоза нет." },
  selectDate:        { de: "Wähle ein Datum",               en: "Select a date",            tr: "Bir tarih seçin",     ar: "اختر تاريخاً",                fr: "Sélectionnez une date",      hi: "एक तिथि चुनें",          es: "Selecciona una fecha",         ru: "Выберите дату" },
  remindersActive:   { de: "Erinnerungen aktiv",           en: "Reminders active",         tr: "Hatırlatıcılar aktif",ar: "التذكيرات نشطة",              fr: "Rappels activés",            hi: "अनुस्मारक सक्रिय",      es: "Recordatorios activos",       ru: "Напоминания активны" },
  activateReminders: { de: "Erinnerungen aktivieren",      en: "Activate reminders",       tr: "Hatırlatıcıları etkinleştir", ar: "تفعيل التذكيرات",      fr: "Activer les rappels",        hi: "अनुस्मारक सक्रिय करें",es: "Activar recordatorios",       ru: "Включить напоминания" },
  cityWebsite:       { de: "Stadt Neu-Ulm Abfallentsorgung", en: "City Neu-Ulm Waste Mgmt", tr: "Neu-Ulm Belediyesi Atık", ar: "إدارة النفايات نوي-أولم", fr: "Gestion déchets Neu-Ulm",   hi: "न्यू-उल्म अपशिष्ट प्रबंधन", es: "Gestión residuos Neu-Ulm", ru: "Управление отходами Ной-Ульма" },
  listView:          { de: "Listenansicht",                 en: "List view",                tr: "Liste görünümü",      ar: "عرض القائمة",                 fr: "Vue liste",                  hi: "सूची दृश्य",             es: "Vista de lista",              ru: "Список" },
  calendarView:      { de: "Kalenderansicht",               en: "Calendar view",            tr: "Takvim görünümü",     ar: "عرض التقويم",                 fr: "Vue calendrier",             hi: "कैलेंडर दृश्य",          es: "Vista de calendario",         ru: "Календарь" },

  // ── Waste Types ────────────────────────────────────────────────────────────
  "Rest- & Biomüll": { de: "Rest- & Biomüll", en: "Residual & Organic",  tr: "Evsel & Organik Atık",  ar: "النفايات المتبقية والعضوية", fr: "Déchets résiduels et organiques", hi: "अवशिष्ट और जैविक", es: "Residuos residuales y orgánicos", ru: "Остаточные и органические отходы" },
  Grüngut:           { de: "Grüngut",         en: "Green Waste",          tr: "Yeşil Atık",            ar: "النفايات الخضراء",           fr: "Déchets verts",                   hi: "हरा कचरा",              es: "Residuos verdes",                ru: "Зеленые отходы" },
  Papiertonne:       { de: "Papiertonne",     en: "Paper Bin",            tr: "Kağıt Kutusu",          ar: "صندوق الورق",                fr: "Poubelle à papier",               hi: "कागज का डिब्बा",        es: "Contenedor de papel",            ru: "Бумажный контейнер" },
  "Gelber Sack":     { de: "Gelber Sack",     en: "Yellow Bag",           tr: "Sarı Torba",            ar: "الكيس الأصفر",               fr: "Sac jaune",                       hi: "पीला बैग",              es: "Saco amarillo",                  ru: "Желтый мешок" },

  // ── Map ────────────────────────────────────────────────────────────────────
  recyclingCenters:      { de: "Wertstoffhöfe",      en: "Recycling Centers",       tr: "Geri Dönüşüm Merkezleri", ar: "مراكز إعادة التدوير", fr: "Centres de recyclage",    hi: "पुनर्चक्रण केंद्र",   es: "Centros de reciclaje",        ru: "Центры переработки" },
  glass:                 { de: "Glas",               en: "Glass",                   tr: "Cam",                     ar: "الزجاج",              fr: "Verre",                   hi: "कांच",                es: "Vidrio",                      ru: "Стекло" },
  clothes:               { de: "Altkleider",          en: "Clothes",                 tr: "Kıyafet",                 ar: "الملابس",             fr: "Vêtements",               hi: "कपड़े",               es: "Ropa",                        ru: "Одежда" },
  others:                { de: "Sonstige",            en: "Others",                  tr: "Diğerleri",               ar: "أخرى",                fr: "Autres",                  hi: "अन्य",                es: "Otros",                       ru: "Другое" },
  routePlan:             { de: "Route planen",        en: "Plan Route",              tr: "Rota Planla",             ar: "تخطيط المسار",        fr: "Planifier l'itinéraire",  hi: "मार्ग की योजना बनाएं", es: "Planificar ruta",             ru: "Проложить маршрут" },
  yourLocation:          { de: "Dein Standort",       en: "Your Location",           tr: "Konumunuz",               ar: "موقعك",               fr: "Votre position",          hi: "आपका स्थान",           es: "Tu ubicación",                ru: "Ваше местоположение" },
  operator:              { de: "Betreiber",           en: "Operator",                tr: "İşletmeci",               ar: "المشغل",              fr: "Opérateur",               hi: "ऑपरेटर",              es: "Operador",                    ru: "Оператор" },
  Wertstoffhof:          { de: "Wertstoffhof",        en: "Recycling Center",        tr: "Geri Dönüşüm Merkezi",    ar: "مركز إعادة التدوير",  fr: "Centre de recyclage",     hi: "पुनर्चक्रण केंद्र",   es: "Centro de reciclaje",         ru: "Центр переработки" },
  Grüngutsammelstelle:   { de: "Grüngutsammelstelle", en: "Green Waste Collection",  tr: "Yeşil Atık Toplama",      ar: "جمع النفايات الخضراء", fr: "Collecte déchets verts",  hi: "हरा कचरा संग्रह",   es: "Recogida residuos verdes",    ru: "Сбор зеленых отходов" },
  Glascontainer:         { de: "Glascontainer",       en: "Glass Container",         tr: "Cam Konteyner",           ar: "حاوية زجاج",          fr: "Conteneur à verre",       hi: "कांच का कंटेनर",      es: "Contenedor de vidrio",        ru: "Стеклянный контейнер" },
  Altkleidercontainer:   { de: "Altkleidercontainer", en: "Clothes Container",       tr: "Kıyafet Konteyneri",      ar: "حاوية ملابس",         fr: "Conteneur à vêtements",   hi: "कपड़े का कंटेनर",    es: "Contenedor de ropa",          ru: "Контейнер для одежды" },
  Wertstoffinsel:        { de: "Wertstoffinsel",      en: "Recycling Island",        tr: "Geri Dönüşüm Adası",      ar: "جزيرة إعادة التدوير", fr: "Îlot de recyclage",       hi: "पुनर्चक्रण द्वीप",   es: "Isla de reciclaje",           ru: "Островок переработки" },

  // ── Settings ───────────────────────────────────────────────────────────────
  reminders:              { de: "Erinnerungen",                  en: "Reminders",                  tr: "Hatırlatıcılar",              ar: "التذكيرات",                   fr: "Rappels",                          hi: "अनुस्मारक",                es: "Recordatorios",                   ru: "Напоминания" },
  neverMissPickup:        { de: "Verpasse keine Abholung mehr",  en: "Never miss a pickup again",  tr: "Hiçbir toplamayı kaçırmayın", ar: "لا تفوت أي عملية جمع مرة أخرى", fr: "Ne manquez plus une collecte",   hi: "फिर कभी कोई पिकअप न चूकें", es: "No te pierdas nunca una recogida", ru: "Никогда не пропускайте вывоз" },
  pushNotifications:      { de: "Push-Benachrichtigungen",       en: "Push Notifications",         tr: "Anlık Bildirimler",           ar: "إشعارات الدفع",               fr: "Notifications Push",               hi: "पुश सूचनाएं",              es: "Notificaciones Push",             ru: "Push-уведомления" },
  reminderTime:           { de: "Erinnerungszeit",               en: "Reminder Time",              tr: "Hatırlatma Zamanı",           ar: "وقت التذكير",                 fr: "Heure du rappel",                  hi: "अनुस्मारक का समय",         es: "Hora del recordatorio",           ru: "Время напоминания" },
  aboutApp:               { de: "Über die App",                  en: "About the App",              tr: "Uygulama Hakkında",           ar: "عن التطبيق",                  fr: "À propos de l'application",        hi: "ऐप के बारे में",           es: "Acerca de la aplicación",         ru: "О приложении" },
  addressSearch:          { de: "Adresse suchen (Neu-Ulm)",      en: "Search address (Neu-Ulm)",   tr: "Adres ara (Neu-Ulm)",         ar: "البحث عن عنوان (نوي-أولم)",   fr: "Rechercher une adresse (Neu-Ulm)", hi: "पता खोजें (न्यू-उल्म)",    es: "Buscar dirección (Neu-Ulm)",       ru: "Поиск адреса (Ной-Ульм)" },
  addressNotFound:        { de: "Adresse nicht gefunden.",       en: "Address not found.",         tr: "Adres bulunamadı.",           ar: "العنوان غير موجود.",          fr: "Adresse introuvable.",             hi: "पता नहीं मिला।",           es: "Dirección no encontrada.",        ru: "Адрес не найден." },
  searchError:            { de: "Fehler bei der Suche.",         en: "Search error.",              tr: "Arama hatası.",               ar: "خطأ في البحث.",               fr: "Erreur de recherche.",             hi: "खोज त्रुटि।",             es: "Error de búsqueda.",              ru: "Ошибка поиска." },
  language:               { de: "Sprache",                       en: "Language",                   tr: "Dil",                         ar: "اللغة",                       fr: "Langue",                           hi: "भाषा",                     es: "Idioma",                          ru: "Язык" },
  appDesc1:               { de: "Müllkalender für Neu-Ulm.",     en: "Waste calendar for Neu-Ulm.", tr: "Neu-Ulm için çöp takvimi.",  ar: "تقويم النفايات لنوي-أولم.",   fr: "Calendrier des déchets pour Neu-Ulm.", hi: "न्यू-उल्म के लिए अपशिष्ट कैलेंडर।", es: "Calendario de residuos para Neu-Ulm.", ru: "Календарь отходов для Ной-Ульма." },
  appDesc2:               { de: "Verfügbar für iOS, Android und Web.", en: "Available for iOS, Android and Web.", tr: "iOS, Android ve Web için mevcut.", ar: "متاح لنظامي iOS و Android والويب.", fr: "Disponible pour iOS, Android et Web.", hi: "iOS, Android और Web के लिए उपलब्ध।", es: "Disponible para iOS, Android y Web.", ru: "Доступно для iOS, Android и Web." },
  version:                { de: "Version",                       en: "Version",                    tr: "Sürüm",                       ar: "الإصدار",                     fr: "Version",                          hi: "संस्करण",                  es: "Versión",                         ru: "Версия" },
  supportOnKofi:          { de: "Auf Ko-fi unterstützen ☕",      en: "Support on Ko-fi ☕",         tr: "Ko-fi'de destekle ☕",         ar: "ادعم على Ko-fi ☕",            fr: "Soutenir sur Ko-fi ☕",             hi: "Ko-fi पर समर्थन करें ☕",   es: "Apoyar en Ko-fi ☕",               ru: "Поддержать на Ko-fi ☕" },
  addressLabel:           { de: "Adresse",                       en: "Address",                    tr: "Adres",                       ar: "العنوان",                     fr: "Adresse",                          hi: "पता",                      es: "Dirección",                       ru: "Адрес" },
  detectLocation:         { de: "Standort ermitteln",            en: "Detect location",            tr: "Konumu belirle",              ar: "تحديد الموقع",                fr: "Détecter la position",             hi: "स्थान का पता लगाएं",        es: "Detectar ubicación",              ru: "Определить местоположение" },
  districtLabel:          { de: "Abfuhrbezirk",                  en: "Collection district",        tr: "Toplama bölgesi",             ar: "منطقة الجمع",                 fr: "Quartier de collecte",             hi: "संग्रह जिला",              es: "Distrito de recogida",            ru: "Район сбора" },
  autoDetected:           { de: "Automatisch erkannt",           en: "Auto-detected",              tr: "Otomatik algılandı",          ar: "تم الكشف تلقائياً",           fr: "Détecté automatiquement",          hi: "स्वचालित रूप से पता चला",   es: "Autodetectado",                   ru: "Автоматически определено" },
  addressNotInRegion:     { de: "Adresse nicht im Versorgungsgebiet.", en: "Address outside service area.", tr: "Adres hizmet alanı dışında.", ar: "العنوان خارج منطقة الخدمة.", fr: "Adresse hors zone de service.", hi: "पता सेवा क्षेत्र के बाहर।", es: "Dirección fuera del área de servicio.", ru: "Адрес за пределами зоны обслуживания." },

  // ── Alerts ─────────────────────────────────────────────────────────────────
  notifsActivated:     { de: "Benachrichtigungen aktiviert!",                  en: "Notifications activated!",                   tr: "Bildirimler etkinleştirildi!",       ar: "تم تفعيل الإشعارات!",              fr: "Notifications activées !",                          hi: "सूचनाएं सक्रिय!",   es: "¡Notificaciones activadas!",         ru: "Уведомления активированы!" },
  notifsDeactivated:   { de: "Benachrichtigungen deaktiviert.",                en: "Notifications deactivated.",                 tr: "Bildirimler devre dışı bırakıldı.", ar: "تم إلغاء تفعيل الإشعارات.",       fr: "Notifications désactivées.",                        hi: "सूचनाएं निष्क्रिय।",  es: "Notificaciones desactivadas.",       ru: "Уведомления деактивированы." },
  allowNotifs:         { de: "Bitte erlaube Benachrichtigungen.",              en: "Please allow notifications.",                 tr: "Lütfen bildirimlere izin verin.",   ar: "يرجى السماح بالإشعارات.",          fr: "Veuillez autoriser les notifications.",              hi: "कृपया सूचनाओं की अनुमति दें।", es: "Por favor, permite las notificaciones.", ru: "Пожалуйста, разрешите уведомления." },
  notifsNotSupported:  { de: "Benachrichtigungen nicht unterstützt.",          en: "Notifications not supported.",                tr: "Bildirimler desteklenmiyor.",        ar: "الإشعارات غير مدعومة.",            fr: "Notifications non supportées.",                     hi: "सूचनाएं समर्थित नहीं।",   es: "Notificaciones no compatibles.",     ru: "Уведомления не поддерживаются." },
  notifsBlocked:       { de: "Benachrichtigungen sind blockiert.",             en: "Notifications are blocked.",                  tr: "Bildirimler engellendi.",            ar: "الإشعارات محظورة.",                fr: "Les notifications sont bloquées.",                   hi: "सूचनाएं अवरुद्ध हैं।",    es: "Las notificaciones están bloqueadas.", ru: "Уведомления заблокированы." },
  geoNotSupported:     { de: "Geolokalisierung nicht unterstützt.",            en: "Geolocation not supported.",                  tr: "Coğrafi konum desteklenmiyor.",      ar: "تحديد الموقع غير مدعوم.",          fr: "Géolocalisation non supportée.",                    hi: "जियोलोकेशन समर्थित नहीं।", es: "Geolocalización no compatible.",     ru: "Геолокация не поддерживается." },
  locationError:       { de: "Fehler bei der Standortermittlung.",             en: "Error detecting location.",                   tr: "Konum belirleme hatası.",            ar: "خطأ في تحديد الموقع.",              fr: "Erreur de détection de position.",                  hi: "स्थान का पता लगाने में त्रुटि।", es: "Error al detectar la ubicación.", ru: "Ошибка определения местоположения." },
  locationDenied:      { de: "Standortzugriff verweigert.",                   en: "Location access denied.",                     tr: "Konum erişimi reddedildi.",          ar: "تم رفض الوصول إلى الموقع.",        fr: "Accès à la position refusé.",                       hi: "स्थान पहुँच अस्वीकृत।",   es: "Acceso a la ubicación denegado.",    ru: "Доступ к местоположению запрещен." },

  // ── Manual ICS Import ──────────────────────────────────────────────────────
  manualCalendarImport:     { de: "Kalender manuell importieren",   en: "Import Calendar Manually",   tr: "Takvimi Manuel İçe Aktar",    ar: "استيراد التقويم يدوياً",       fr: "Importer le calendrier manuellement", hi: "कैलेंडर मैन्युअल रूप से आयात करें", es: "Importar calendario manualmente",   ru: "Импортировать календарь вручную" },
  manualCalendarImportDesc: { de: "Lade eine .ics-Datei hoch.", en: "Upload an .ics file from the city.", tr: ".ics dosyası yükleyin.", ar: "قم بتحميل ملف .ics.", fr: "Téléchargez un fichier .ics.", hi: ".ics फ़ाइल अपलोड करें।", es: "Sube un archivo .ics.", ru: "Загрузите файл .ics." },
  calendarImportSuccess:    { de: "Kalender erfolgreich importiert!", en: "Calendar imported successfully!", tr: "Takvim başarıyla içe aktarıldı!", ar: "تم استيراد التقويم بنجاح!", fr: "Calendrier importé avec succès !", hi: "कैलेंडर सफलतापूर्वक आयात किया गया!", es: "¡Calendario importado con éxito!", ru: "Календарь успешно импортирован!" },
  calendarImportError:      { de: "Fehler beim Importieren.", en: "Error importing the calendar.", tr: "İçe aktarma hatası.", ar: "خطأ في الاستيراد.", fr: "Erreur d'importation.", hi: "आयात त्रुटि।", es: "Error al importar.", ru: "Ошибка импорта." },
  importButton:             { de: ".ics-Datei hochladen", en: "Upload .ics File", tr: ".ics Dosyası Yükle", ar: "رفع ملف .ics", fr: "Télécharger .ics", hi: ".ics अपलोड करें", es: "Subir .ics", ru: "Загрузить .ics" },
  calendarImportCleared:    { de: "Importierter Kalender entfernt.", en: "Imported calendar cleared.", tr: "İçe aktarılan takvim temizlendi.", ar: "تم مسح التقويم.", fr: "Calendrier importé effacé.", hi: "आयातित कैलेंडर हटाया गया।", es: "Calendario borrado.", ru: "Календарь очищен." },

  // ── Time options ───────────────────────────────────────────────────────────
  time17: { de: "17:00 Uhr (Vortag)", en: "5:00 PM (Day before)",  tr: "17:00 (Önceki gün)", ar: "17:00 (اليوم السابق)", fr: "17:00 (La veille)", hi: "17:00 (एक दिन पहले)", es: "17:00 (Día anterior)", ru: "17:00 (За день до)" },
  time18: { de: "18:00 Uhr (Vortag)", en: "6:00 PM (Day before)",  tr: "18:00 (Önceki gün)", ar: "18:00 (اليوم السابق)", fr: "18:00 (La veille)", hi: "18:00 (एक दिन पहले)", es: "18:00 (Día anterior)", ru: "18:00 (За день до)" },
  time19: { de: "19:00 Uhr (Vortag)", en: "7:00 PM (Day before)",  tr: "19:00 (Önceki gün)", ar: "19:00 (اليوم السابق)", fr: "19:00 (La veille)", hi: "19:00 (एक दिन पहले)", es: "19:00 (Día anterior)", ru: "19:00 (За день до)" },
  time20: { de: "20:00 Uhr (Vortag)", en: "8:00 PM (Day before)",  tr: "20:00 (Önceki gün)", ar: "20:00 (اليوم السابق)", fr: "20:00 (La veille)", hi: "20:00 (एक दिन पहले)", es: "20:00 (Día anterior)", ru: "20:00 (За день до)" },
  time06: { de: "06:00 Uhr (Am Tag)", en: "6:00 AM (Same day)",    tr: "06:00 (Aynı gün)",   ar: "06:00 (نفس اليوم)",    fr: "06:00 (Le jour même)", hi: "06:00 (उसी दिन)", es: "06:00 (Mismo día)", ru: "06:00 (В тот же день)" },
  time07: { de: "07:00 Uhr (Am Tag)", en: "7:00 AM (Same day)",    tr: "07:00 (Aynı gün)",   ar: "07:00 (نفس اليوم)",    fr: "07:00 (Le jour même)", hi: "07:00 (उसी दिन)", es: "07:00 (Mismo día)", ru: "07:00 (В тот же день)" },

  // ── Data refresh (added v1.4) ──────────────────────────────────────────────
  refreshData:        { de: "Daten aktualisieren",             en: "Refresh Data",                   tr: "Verileri Güncelle",              ar: "تحديث البيانات",                  fr: "Actualiser les données",           hi: "डेटा रिफ्रेश करें",              es: "Actualizar datos",                    ru: "Обновить данные" },
  refreshing:         { de: "Wird aktualisiert…",              en: "Refreshing…",                    tr: "Güncelleniyor…",                  ar: "جارٍ التحديث…",                   fr: "Actualisation…",                   hi: "रिफ्रेश हो रहा है…",              es: "Actualizando…",                       ru: "Обновляется…" },
  dataUpdated:        { de: "Daten erfolgreich aktualisiert!", en: "Data updated successfully!",      tr: "Veriler başarıyla güncellendi!",  ar: "تم تحديث البيانات بنجاح!",        fr: "Données mises à jour avec succès !", hi: "डेटा सफलतापूर्वक अपडेट हुआ!",   es: "¡Datos actualizados con éxito!",      ru: "Данные успешно обновлены!" },
  dataAlreadyFresh:   { de: "Daten sind aktuell.",             en: "Data is already up to date.",     tr: "Veriler güncel.",                 ar: "البيانات محدّثة بالفعل.",         fr: "Données déjà à jour.",             hi: "डेटा पहले से अपडेट है।",          es: "Los datos ya están actualizados.",    ru: "Данные уже актуальны." },
  dataUpdateFailed:   { de: "Aktualisierung fehlgeschlagen. Bitte Internetverbindung prüfen.", en: "Update failed. Please check your connection.", tr: "Güncelleme başarısız. İnternet bağlantısını kontrol edin.", ar: "فشل التحديث. يرجى التحقق من الاتصال.", fr: "Échec de la mise à jour. Vérifiez votre connexion.", hi: "अपडेट विफल। कनेक्शन जांचें।", es: "Error al actualizar. Comprueba tu conexión.", ru: "Ошибка обновления. Проверьте подключение." },
  lastUpdated:        { de: "Zuletzt aktualisiert",            en: "Last updated",                   tr: "Son güncelleme",                  ar: "آخر تحديث",                       fr: "Dernière mise à jour",             hi: "अंतिम अपडेट",                    es: "Última actualización",                ru: "Последнее обновление" },
  neverUpdated:       { de: "Noch nicht synchronisiert",       en: "Never synced",                   tr: "Hiç güncellenmedi",               ar: "لم يتزامن قط",                    fr: "Jamais synchronisé",               hi: "कभी सिंक नहीं हुआ",               es: "Nunca sincronizado",                  ru: "Никогда не синхронизировалось" },
  justNow:            { de: "Gerade eben",                     en: "Just now",                       tr: "Az önce",                         ar: "للتو",                            fr: "À l'instant",                      hi: "अभी-अभी",                         es: "Ahora mismo",                         ru: "Только что" },
  minutesAgo:         { de: "Vor {n} Min.",                    en: "{n} min. ago",                   tr: "{n} dakika önce",                 ar: "منذ {n} دقيقة",                   fr: "Il y a {n} min.",                  hi: "{n} मिनट पहले",                   es: "Hace {n} min.",                       ru: "{n} мин. назад" },
  hoursAgo:           { de: "Vor {n} Std.",                    en: "{n} hr. ago",                    tr: "{n} saat önce",                   ar: "منذ {n} ساعة",                    fr: "Il y a {n} h.",                    hi: "{n} घंटे पहले",                   es: "Hace {n} h.",                         ru: "{n} ч. назад" },
  daysAgo:            { de: "Vor {n} Tagen",                   en: "{n} days ago",                   tr: "{n} gün önce",                    ar: "منذ {n} يوم",                     fr: "Il y a {n} jours",                 hi: "{n} दिन पहले",                    es: "Hace {n} días",                       ru: "{n} дн. назад" },
  autoRefreshed:      { de: "Daten monatlich aktualisiert ✓",  en: "Monthly data refresh complete ✓", tr: "Aylık güncelleme tamamlandı ✓",  ar: "تجديد شهري اكتمل ✓",             fr: "Actualisation mensuelle terminée ✓", hi: "मासिक अपडेट पूर्ण ✓",           es: "Actualización mensual completada ✓",  ru: "Ежемесячное обновление завершено ✓" },
  dataSection:        { de: "Daten",                           en: "Data",                           tr: "Veriler",                         ar: "البيانات",                        fr: "Données",                          hi: "डेटा",                            es: "Datos",                               ru: "Данные" },

  // ── Location / address detection (added v2) ────────────────────────────────
  currentLocation:     { de: "Aktueller Standort",                    en: "Current location",                       tr: "Mevcut konum",                              ar: "الموقع الحالي",                                fr: "Position actuelle",                            hi: "वर्तमान स्थान",                                  es: "Ubicación actual",                            ru: "Текущее местоположение" },
  locationDetected:    { de: "Standort erkannt",                      en: "Location detected",                      tr: "Konum tespit edildi",                       ar: "تم تحديد الموقع",                              fr: "Position détectée",                            hi: "स्थान पाया गया",                                 es: "Ubicación detectada",                         ru: "Местоположение определено" },
  outsideRegionTitle:  { de: "Außerhalb von Neu-Ulm",                 en: "Outside Neu-Ulm",                        tr: "Neu-Ulm dışında",                           ar: "خارج نيو-أولم",                                fr: "Hors de Neu-Ulm",                              hi: "नोय-उल्म के बाहर",                              es: "Fuera de Neu-Ulm",                            ru: "За пределами Нойульма" },
  outsideRegionBody:   { de: "Dein Standort scheint außerhalb der bekannten Stadtteile zu liegen. Der bisher gewählte Bezirk bleibt aktiv. Du kannst ihn in den Einstellungen manuell ändern.", en: "Your location appears to be outside the known city districts. The previously selected zone stays active. You can change it manually in Settings.", tr: "Konumunuz bilinen mahallelerin dışında görünüyor. Önceden seçilen bölge aktif kalır. Ayarlardan manuel olarak değiştirebilirsiniz.", ar: "يبدو أن موقعك خارج الأحياء المعروفة. تظل المنطقة المحددة سابقاً نشطة. يمكنك تغييرها يدوياً في الإعدادات.", fr: "Votre position semble être en dehors des quartiers connus. La zone précédemment sélectionnée reste active. Vous pouvez la modifier manuellement dans les paramètres.", hi: "आपका स्थान ज्ञात क्षेत्रों के बाहर प्रतीत होता है। पहले चुना गया ज़ोन सक्रिय रहेगा। आप इसे सेटिंग्स में मैन्युअल रूप से बदल सकते हैं।", es: "Tu ubicación parece estar fuera de los distritos conocidos. La zona seleccionada previamente permanece activa. Puedes cambiarla manualmente en Configuración.", ru: "Ваше местоположение, похоже, находится за пределами известных районов. Ранее выбранная зона остаётся активной. Вы можете изменить её вручную в настройках." },
  addressSaved:        { de: "Adresse gespeichert",                   en: "Address saved",                          tr: "Adres kaydedildi",                          ar: "تم حفظ العنوان",                                fr: "Adresse enregistrée",                          hi: "पता सहेजा गया",                                  es: "Dirección guardada",                          ru: "Адрес сохранён" },
  addressOutsideTitle: { de: "Adresse außerhalb",                     en: "Address outside region",                 tr: "Adres bölge dışı",                          ar: "العنوان خارج المنطقة",                          fr: "Adresse hors zone",                            hi: "पता क्षेत्र के बाहर",                           es: "Dirección fuera de la zona",                  ru: "Адрес за пределами зоны" },
  addressOutsideBody:  { de: "Diese Adresse liegt außerhalb der erkennbaren Stadtteile von Neu-Ulm. Der bisher gewählte Bezirk bleibt aktiv. Du kannst ihn unten manuell ändern.", en: "This address is outside the recognizable city districts of Neu-Ulm. The previously selected zone stays active. You can change it manually below.", tr: "Bu adres, Neu-Ulm'un tanınan mahallelerinin dışındadır. Önceden seçilen bölge aktif kalır. Aşağıda manuel olarak değiştirebilirsiniz.", ar: "هذا العنوان يقع خارج الأحياء المعروفة في نيو-أولم. تظل المنطقة المحددة سابقاً نشطة. يمكنك تغييرها يدوياً أدناه.", fr: "Cette adresse est hors des quartiers reconnus de Neu-Ulm. La zone précédemment sélectionnée reste active. Vous pouvez la modifier manuellement ci-dessous.", hi: "यह पता नोय-उल्म के पहचाने जाने वाले क्षेत्रों के बाहर है। पहले चुना गया ज़ोन सक्रिय रहेगा। आप इसे नीचे मैन्युअल रूप से बदल सकते हैं।", es: "Esta dirección está fuera de los distritos reconocibles de Neu-Ulm. La zona seleccionada previamente permanece activa. Puedes cambiarla manualmente abajo.", ru: "Этот адрес находится за пределами узнаваемых районов Нойульма. Ранее выбранная зона остаётся активной. Вы можете изменить её вручную ниже." },
  browserNoGeo:        { de: "Dein Browser unterstützt keine Standortermittlung.", en: "Your browser does not support geolocation.", tr: "Tarayıcınız konum belirlemeyi desteklemiyor.", ar: "متصفحك لا يدعم تحديد الموقع.",                  fr: "Votre navigateur ne prend pas en charge la géolocalisation.", hi: "आपका ब्राउज़र स्थान निर्धारण का समर्थन नहीं करता।", es: "Tu navegador no admite geolocalización.",          ru: "Ваш браузер не поддерживает определение местоположения." },
  geoErrPermission:    { de: "Standortzugriff abgelehnt. Bitte erlaube ihn in den Browser-Einstellungen.", en: "Location access denied. Please allow it in browser settings.", tr: "Konum erişimi reddedildi. Lütfen tarayıcı ayarlarından izin verin.", ar: "تم رفض الوصول إلى الموقع. يرجى السماح به في إعدادات المتصفح.", fr: "Accès à la position refusé. Veuillez l'autoriser dans les paramètres du navigateur.", hi: "स्थान पहुँच अस्वीकृत। कृपया ब्राउज़र सेटिंग्स में अनुमति दें।", es: "Acceso a la ubicación denegado. Permítelo en la configuración del navegador.", ru: "Доступ к местоположению запрещён. Разрешите его в настройках браузера." },
  geoErrUnavailable:   { de: "Standort derzeit nicht verfügbar. Bitte später erneut versuchen.", en: "Location currently unavailable. Please try again later.", tr: "Konum şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.", ar: "الموقع غير متاح حالياً. يرجى المحاولة لاحقاً.",     fr: "Position indisponible actuellement. Réessayez plus tard.", hi: "स्थान वर्तमान में अनुपलब्ध है। कृपया बाद में पुनः प्रयास करें।", es: "Ubicación no disponible. Inténtalo de nuevo más tarde.", ru: "Местоположение временно недоступно. Попробуйте позже." },
  geoErrTimeout:       { de: "Zeitüberschreitung beim Standortabruf.", en: "Location request timed out.",          tr: "Konum isteği zaman aşımına uğradı.",        ar: "انتهت مهلة طلب الموقع.",                       fr: "Délai d'attente dépassé pour la position.",   hi: "स्थान अनुरोध की समय सीमा समाप्त।",              es: "Tiempo de espera agotado para la ubicación.", ru: "Время ожидания местоположения истекло." },
  permGrantPlease:     { de: "Bitte Berechtigung erteilen.",          en: "Please grant permission.",               tr: "Lütfen izin verin.",                         ar: "يرجى منح الإذن.",                              fr: "Veuillez accorder l'autorisation.",            hi: "कृपया अनुमति दें।",                              es: "Por favor, concede el permiso.",              ru: "Пожалуйста, предоставьте разрешение." },
  permIosPath:         { de: "Bitte in den iOS-Einstellungen unter Datenschutz → Ortungsdienste aktivieren.", en: "Enable in iOS Settings → Privacy → Location Services.", tr: "iOS Ayarları → Gizlilik → Konum Servisleri'nden etkinleştirin.", ar: "فعّل في إعدادات iOS → الخصوصية → خدمات تحديد المواقع.", fr: "Activez dans Réglages iOS → Confidentialité → Service de localisation.", hi: "iOS सेटिंग्स → गोपनीयता → स्थान सेवाएँ में सक्षम करें।", es: "Activa en Ajustes iOS → Privacidad → Localización.", ru: "Включите в Настройках iOS → Конфиденциальность → Службы геолокации." },
  permAndroidPath:     { de: "Bitte in den Android-Einstellungen unter Apps → Berechtigungen → Standort aktivieren.", en: "Enable in Android Settings → Apps → Permissions → Location.", tr: "Android Ayarları → Uygulamalar → İzinler → Konum'dan etkinleştirin.", ar: "فعّل في إعدادات أندرويد → التطبيقات → الأذونات → الموقع.", fr: "Activez dans Paramètres Android → Applications → Autorisations → Localisation.", hi: "Android सेटिंग्स → ऐप्स → अनुमतियाँ → स्थान में सक्षम करें।", es: "Activa en Ajustes Android → Aplicaciones → Permisos → Ubicación.", ru: "Включите в Настройках Android → Приложения → Разрешения → Местоположение." },
  servicesDisabled:    { de: "Standortdienste sind ausgeschaltet. Bitte aktiviere sie auf dem Gerät.", en: "Location services are off. Please enable them on the device.", tr: "Konum servisleri kapalı. Lütfen cihazınızda etkinleştirin.", ar: "خدمات الموقع معطلة. يرجى تفعيلها على الجهاز.",  fr: "Services de localisation désactivés. Activez-les sur l'appareil.", hi: "स्थान सेवाएँ बंद हैं। कृपया डिवाइस पर सक्षम करें।", es: "Servicios de ubicación desactivados. Actívalos en el dispositivo.", ru: "Службы геолокации отключены. Включите их на устройстве." },
  genericLocationError:{ de: "Standort konnte nicht ermittelt werden.", en: "Could not determine location.",         tr: "Konum belirlenemedi.",                       ar: "تعذر تحديد الموقع.",                            fr: "Impossible de déterminer la position.",        hi: "स्थान निर्धारित नहीं किया जा सका।",             es: "No se pudo determinar la ubicación.",         ru: "Не удалось определить местоположение." },
  notifsActivationError:{ de: "Fehler beim Aktivieren der Benachrichtigungen.", en: "Failed to activate notifications.", tr: "Bildirimler etkinleştirilemedi.",        ar: "فشل تفعيل الإشعارات.",                          fr: "Échec de l'activation des notifications.",    hi: "सूचनाएँ सक्रिय करने में विफल।",                  es: "Error al activar las notificaciones.",        ru: "Не удалось включить уведомления." },
  remindersScheduled:  { de: "{count} Erinnerungen geplant.",         en: "{count} reminders scheduled.",            tr: "{count} hatırlatma planlandı.",             ar: "تم جدولة {count} تذكيرات.",                   fr: "{count} rappels programmés.",                  hi: "{count} रिमाइंडर निर्धारित।",                    es: "{count} recordatorios programados.",          ru: "Запланировано {count} напоминаний." },
  locateHintMap:       { de: "Adresse oder Standort über die Karte einstellen.", en: "Set address or location via the Map tab.", tr: "Adres veya konumu Harita sekmesinden ayarlayın.", ar: "اضبط العنوان أو الموقع من علامة تبويب الخريطة.", fr: "Définissez l'adresse ou la position via l'onglet Carte.", hi: "मानचित्र टैब के माध्यम से पता या स्थान सेट करें।", es: "Establece la dirección o ubicación en la pestaña Mapa.", ru: "Задайте адрес или местоположение через вкладку Карта." },
  iosNotifSettings:    { de: "Einstellungen → Mitteilungen → Neu-Ulm Müllkalender", en: "Settings → Notifications → Neu-Ulm Müllkalender", tr: "Ayarlar → Bildirimler → Neu-Ulm Müllkalender", ar: "الإعدادات → الإشعارات → Neu-Ulm Müllkalender", fr: "Réglages → Notifications → Neu-Ulm Müllkalender", hi: "सेटिंग्स → सूचनाएँ → Neu-Ulm Müllkalender", es: "Ajustes → Notificaciones → Neu-Ulm Müllkalender", ru: "Настройки → Уведомления → Neu-Ulm Müllkalender" },
  androidNotifSettings:{ de: "Einstellungen → Apps → Neu-Ulm Müllkalender → Benachrichtigungen", en: "Settings → Apps → Neu-Ulm Müllkalender → Notifications", tr: "Ayarlar → Uygulamalar → Neu-Ulm Müllkalender → Bildirimler", ar: "الإعدادات → التطبيقات → Neu-Ulm Müllkalender → الإشعارات", fr: "Paramètres → Applications → Neu-Ulm Müllkalender → Notifications", hi: "सेटिंग्स → ऐप्स → Neu-Ulm Müllkalender → सूचनाएँ", es: "Ajustes → Aplicaciones → Neu-Ulm Müllkalender → Notificaciones", ru: "Настройки → Приложения → Neu-Ulm Müllkalender → Уведомления" },
};

// ── Context ────────────────────────────────────────────────────────────────────

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("de");
  const [isLoading, setIsLoading] = useState(true);

  // Load persisted language on mount.
  // Race against a 1.5s failsafe so a broken AsyncStorage layer never blocks
  // the entire app on the splash/loading screen.
  useEffect(() => {
    let cancelled = false;
    const failsafe = setTimeout(() => {
      if (!cancelled) {
        console.warn("[i18n] language load exceeded 1.5s — using default 'de'");
        setIsLoading(false);
      }
    }, 1_500);

    storage.getItem("appLanguage")
      .then((saved) => {
        if (cancelled) return;
        if (saved && (SUPPORTED_LANGUAGES as string[]).includes(saved)) {
          const lang = saved as Language;
          setLanguageState(lang);
          applyRtl(lang);
        }
      })
      .catch((err) => console.warn("[i18n] language load failed:", err))
      .finally(() => {
        clearTimeout(failsafe);
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
    };
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    applyRtl(lang);
    storage.setItem("appLanguage", lang);
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    let text = translations[key]?.[language] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isLoading }}>
      {children}
    </LanguageContext.Provider>
  );
}

function applyRtl(_lang: Language) {
  // Intentionally no-op.
  //
  // I18nManager.forceRTL flips the ENTIRE layout engine (all flex-row become
  // row-reverse, left↔right paddings swap, icons mirror).  On React Native this
  // only takes full effect after an app restart, so calling it mid-session
  // produces a half-flipped UI.  It also inverts non-text UI elements like the
  // language picker rows, causing the "Arabic position should be same" bug.
  //
  // Arabic (and other RTL scripts) render correctly at the character level
  // without forceRTL — Unicode's Bidirectional Algorithm handles it natively.
  // We keep the layout direction LTR for a consistent cross-language UI.
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useTranslation must be used within a LanguageProvider");
  return ctx;
}
