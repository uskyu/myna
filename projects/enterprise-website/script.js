document.addEventListener('DOMContentLoaded', () => {

    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            // 移动端点击导航后收起菜单
            const menu = document.querySelector('.nav-menu');
            if (menu) menu.classList.remove('open');
        });
    });

    // 移动端汉堡菜单切换
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('open');
        });
    }

    // 联系表单提交
    const contactForm = document.querySelector('.contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            alert('感谢您的留言！我们会尽快与您联系。');
            contactForm.reset();
        });
    }

    // CTA 按钮 - 滚动到关于我们
    const ctaButton = document.querySelector('.cta-button');
    if (ctaButton) {
        ctaButton.addEventListener('click', () => {
            const about = document.querySelector('#about');
            if (about) about.scrollIntoView({ behavior: 'smooth' });
        });
    }

    // 产品"查看详情"按钮
    document.querySelectorAll('.product-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            alert('产品详情页面开发中，敬请期待！');
        });
    });

    // 滚动时导航栏阴影效果
    window.addEventListener('scroll', () => {
        const navbar = document.querySelector('.navbar');
        if (navbar) {
            navbar.style.boxShadow = window.scrollY > 50
                ? '0 4px 12px rgba(0,0,0,0.15)'
                : '0 2px 10px rgba(0,0,0,0.1)';
        }
    });

});
