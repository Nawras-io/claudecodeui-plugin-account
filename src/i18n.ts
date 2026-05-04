export type Lang = 'en' | 'ar';

export type Strings = {
  title: string;
  subtitle: string;
  username: {
    heading: string;
    currentLabel: string;
    newLabel: string;
    newHelp: string;
    passwordLabel: string;
    submit: string;
    saving: string;
    success: string;
  };
  password: {
    heading: string;
    currentLabel: string;
    newLabel: string;
    newHelp: string;
    confirmLabel: string;
    submit: string;
    saving: string;
    success: string;
    mismatch: string;
  };
  errors: { network: string; generic: string };
};

const dict: Record<Lang, Strings> = {
  en: {
    title: 'Account',
    subtitle: 'Change your username or password.',
    username: {
      heading: 'Change username',
      currentLabel: 'Current username',
      newLabel: 'New username',
      newHelp: '3–32 characters. Letters, numbers, underscore.',
      passwordLabel: 'Current password',
      submit: 'Update username',
      saving: 'Updating…',
      success: 'Username updated.',
    },
    password: {
      heading: 'Change password',
      currentLabel: 'Current password',
      newLabel: 'New password',
      newHelp: 'At least 8 characters.',
      confirmLabel: 'Confirm new password',
      submit: 'Update password',
      saving: 'Updating…',
      success: 'Password updated.',
      mismatch: 'Passwords do not match.',
    },
    errors: {
      network: 'Network error. Please try again.',
      generic: 'Something went wrong.',
    },
  },
  ar: {
    title: 'الحساب',
    subtitle: 'غيّر اسم المستخدم أو كلمة المرور.',
    username: {
      heading: 'تغيير اسم المستخدم',
      currentLabel: 'اسم المستخدم الحالي',
      newLabel: 'اسم المستخدم الجديد',
      newHelp: 'من 3 إلى 32 حرفاً. حروف وأرقام وشرطة سفلية.',
      passwordLabel: 'كلمة المرور الحالية',
      submit: 'تحديث اسم المستخدم',
      saving: 'جارٍ التحديث…',
      success: 'تم تحديث اسم المستخدم.',
    },
    password: {
      heading: 'تغيير كلمة المرور',
      currentLabel: 'كلمة المرور الحالية',
      newLabel: 'كلمة المرور الجديدة',
      newHelp: '8 أحرف على الأقل.',
      confirmLabel: 'تأكيد كلمة المرور الجديدة',
      submit: 'تحديث كلمة المرور',
      saving: 'جارٍ التحديث…',
      success: 'تم تحديث كلمة المرور.',
      mismatch: 'كلمتا المرور غير متطابقتين.',
    },
    errors: {
      network: 'خطأ في الشبكة. حاول مجدداً.',
      generic: 'حدث خطأ ما.',
    },
  },
};

export function pickLang(): Lang {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return lang.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function strings(lang: Lang): Strings {
  return dict[lang];
}
