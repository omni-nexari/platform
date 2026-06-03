import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

function ProseSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      {title && <h2 className="text-lg font-bold text-white mb-3">{title}</h2>}
      <div className="text-sm text-[#b0b8cc] leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="min-h-dvh" style={{ background: '#0b0d11', color: '#e8eaf0' }}>
      <header className="sticky top-0 z-50 border-b" style={{ background: 'rgba(11,13,17,0.92)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/marketing" className="flex items-center gap-1.5 text-sm text-[#7a8299] hover:text-white transition-colors">
            <ArrowLeft size={14} /> Back
          </Link>
          <span className="text-[rgba(255,255,255,0.15)]">|</span>
          <span className="text-sm font-semibold">Terms and Conditions</span>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-white mb-2">Terms and Conditions</h1>
        <p className="text-sm text-[#7a8299] mb-10">Last updated: June 2, 2026</p>

        <p className="text-sm text-[#b0b8cc] leading-relaxed mb-8">
          These Terms and Conditions ("Terms") govern your access to and use of the Nexari OmniHub platform,
          including its website, web dashboard, APIs, and associated services (collectively, the "Service")
          operated by <strong className="text-white">Nexari Technologies</strong> ("Company", "we", "us", or "our").
          By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <ProseSection title="1. Definitions">
          <ul className="space-y-2 list-disc pl-5">
            <li><strong className="text-white">"Account"</strong> – a registered account that grants access to the Service.</li>
            <li><strong className="text-white">"Content"</strong> – any media, data, text, images, videos, HTML packages, or other material uploaded, published, or displayed through the Service.</li>
            <li><strong className="text-white">"Device"</strong> – a screen or display player connected to and managed through the Service.</li>
            <li><strong className="text-white">"Organization"</strong> – a tenant workspace created within the Service to represent a business or entity.</li>
            <li><strong className="text-white">"User"</strong> – any individual who accesses the Service under an Account.</li>
            <li><strong className="text-white">"Reseller / Management Company"</strong> – a User or Organization that manages one or more client Organizations through the Service.</li>
          </ul>
        </ProseSection>

        <ProseSection title="2. Acceptance of Terms">
          <p>By creating an Account, accessing the dashboard, or using the Service in any way, you confirm that:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>You are at least 18 years of age or have the legal authority to enter into a binding agreement on behalf of your organization.</li>
            <li>You have the authority to bind your organization to these Terms where you are acting on behalf of a business.</li>
            <li>You have read and understood these Terms in full.</li>
          </ol>
        </ProseSection>

        <ProseSection title="3. Account Registration and Security">
          <p>3.1 You must provide accurate, current, and complete information when registering an Account and keep it up to date.</p>
          <p>3.2 You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your Account.</p>
          <p>3.3 You must notify us immediately at <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a> if you suspect any unauthorized access to your Account.</p>
          <p>3.4 We reserve the right to suspend or terminate Accounts that display signs of unauthorized use, fraud, or misuse.</p>
        </ProseSection>

        <ProseSection title="4. Permitted Use">
          <p>4.1 You may use the Service only for lawful purposes and in accordance with these Terms.</p>
          <p>4.2 You agree not to: upload unlawful, defamatory, or infringing Content; transmit spam or malware; attempt unauthorized access; reverse-engineer the Service; resell without authorization; or use automated tools to scrape data.</p>
          <p>4.3 We reserve the right to remove any Content and suspend or terminate any Account that violates this section without prior notice.</p>
        </ProseSection>

        <ProseSection title="5. Content Ownership and Responsibility">
          <p>5.1 <strong className="text-white">Your Content.</strong> You retain all ownership rights to the Content you upload. By uploading Content, you grant Nexari Technologies a non-exclusive, worldwide, royalty-free licence to store, process, and display that Content solely for the purpose of providing the Service to you.</p>
          <p>5.2 <strong className="text-white">Responsibility.</strong> You are solely responsible for the accuracy, legality, and appropriateness of all Content you publish through the Service, including obtaining any necessary licences for music, images, fonts, trademarks, or third-party materials.</p>
          <p>5.3 We do not monitor, endorse, or take responsibility for Content uploaded by Users.</p>
        </ProseSection>

        <ProseSection title="6. Intellectual Property">
          <p>The Service, including its software, design, features, logos, and documentation, is owned by or licenced to Nexari Technologies and is protected by Canadian and international intellectual property laws. These Terms do not transfer any intellectual property rights to you.</p>
        </ProseSection>

        <ProseSection title="7. Reseller and Multi-Tenant Use">
          <p>7.1 Organizations operating as Resellers or Management Companies are authorized to create and manage client Organizations within the Service, subject to these Terms and any additional Reseller agreement.</p>
          <p>7.2 Resellers are responsible for ensuring their end-client Organizations comply with these Terms and applicable law.</p>
          <p>7.3 Nexari Technologies is not liable for any obligations, representations, or warranties made by Resellers to their end-clients beyond those expressly stated in these Terms.</p>
        </ProseSection>

        <ProseSection title="8. Fees and Payment">
          <p>8.1 Certain features or subscription tiers of the Service are provided for a fee. Applicable fees and payment terms are described in the relevant order form, subscription page, or commercial agreement.</p>
          <p>8.2 All fees are exclusive of applicable taxes unless stated otherwise. You are responsible for any applicable taxes in your jurisdiction.</p>
          <p>8.3 We reserve the right to modify pricing with reasonable notice. Continued use of the Service after a price change constitutes acceptance of the new pricing.</p>
          <p>8.4 Fees paid are non-refundable except as required by applicable law or as otherwise expressly agreed in writing.</p>
        </ProseSection>

        <ProseSection title="9. Service Availability and Modifications">
          <p>We strive to maintain high availability but do not guarantee uninterrupted, error-free access to the Service. We may modify, suspend, or discontinue any part of the Service at any time, with reasonable efforts to notify Users of planned downtime or significant changes.</p>
        </ProseSection>

        <ProseSection title="10. Third-Party Services and Integrations">
          <p>The Service may integrate with or link to third-party services (e.g., POS systems, analytics providers, device platforms). Your use of those third-party services is governed by their own terms and privacy policies. We are not responsible for the content, accuracy, or availability of any third-party services.</p>
        </ProseSection>

        <ProseSection title="11. Privacy and Data">
          <p>Our collection and use of personal information is governed by our <Link to="/marketing/privacy" className="text-[#3a7bff] hover:underline">Privacy Policy</Link>, which is incorporated into these Terms by reference. You are responsible for ensuring that any personal data you process through the Service complies with applicable privacy legislation, including Canada's PIPEDA and applicable provincial privacy laws.</p>
        </ProseSection>

        <ProseSection title="13. Disclaimers">
          <p className="uppercase text-xs tracking-wide">
            To the maximum extent permitted by applicable law, the service is provided "as is" and "as available", without warranties of any kind, express or implied. We disclaim all warranties, including but not limited to fitness for a particular purpose, merchantability, and non-infringement.
          </p>
        </ProseSection>

        <ProseSection title="14. Limitation of Liability">
          <p className="uppercase text-xs tracking-wide">
            To the maximum extent permitted by applicable law, Nexari Technologies and its officers, directors, employees, and agents shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of or inability to use the service. Our total cumulative liability shall not exceed the greater of: (a) amounts paid in the three months preceding the claim, or (b) one hundred Canadian dollars (CAD $100).
          </p>
        </ProseSection>

        <ProseSection title="15. Indemnification">
          <p>You agree to indemnify, defend, and hold harmless Nexari Technologies and its affiliates, officers, employees, and agents from and against any claims, damages, losses, liabilities, costs, and expenses arising out of your use of the Service in violation of these Terms, your Content, or your violation of any applicable law.</p>
        </ProseSection>

        <ProseSection title="16. Termination">
          <p>16.1 <strong className="text-white">By You.</strong> You may stop using the Service and close your Account at any time by contacting <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a>.</p>
          <p>16.2 <strong className="text-white">By Us.</strong> We may suspend or terminate your access immediately and without prior notice if you breach these Terms, if required by law, or for any other legitimate business reason.</p>
        </ProseSection>

        <ProseSection title="17. Governing Law and Dispute Resolution">
          <p>These Terms are governed by the laws of the Province of Ontario, Canada. Any unresolved dispute shall be submitted to binding arbitration in accordance with the rules of the ADR Institute of Canada.</p>
        </ProseSection>

        <ProseSection title="20. Contact Us">
          <p><strong className="text-white">Nexari Technologies</strong><br />Email: <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a></p>
        </ProseSection>

        <div className="pt-8 border-t text-xs text-[#7a8299]" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          These Terms and Conditions were last reviewed and updated on June 2, 2026.
        </div>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="min-h-dvh" style={{ background: '#0b0d11', color: '#e8eaf0' }}>
      <header className="sticky top-0 z-50 border-b" style={{ background: 'rgba(11,13,17,0.92)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/marketing" className="flex items-center gap-1.5 text-sm text-[#7a8299] hover:text-white transition-colors">
            <ArrowLeft size={14} /> Back
          </Link>
          <span className="text-[rgba(255,255,255,0.15)]">|</span>
          <span className="text-sm font-semibold">Privacy Policy</span>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#7a8299] mb-10">Last updated: June 2, 2026</p>

        <p className="text-sm text-[#b0b8cc] leading-relaxed mb-8">
          Nexari Technologies ("Nexari", "we", "us", or "our") is committed to protecting the privacy of individuals
          who visit our website and use the Nexari OmniHub platform (the "Service"). This Privacy Policy explains
          what personal information we collect, how we use and protect it, and your rights regarding that information.
          This policy is written in compliance with Canada's PIPEDA and applicable provincial privacy legislation.
        </p>

        <ProseSection title="1. Who This Policy Applies To">
          <p>This policy applies to visitors to our website, users who register for and use the Nexari OmniHub dashboard or APIs, and Resellers/Management Companies and their authorized staff.</p>
          <p>If you are an employee or end user of one of our business customers, your organization is the primary data controller. Please refer to your organization's own privacy policy.</p>
        </ProseSection>

        <ProseSection title="2. Information We Collect">
          <p><strong className="text-white">You provide directly:</strong> account registration (name, email, password, company, role), billing and payment information (processed by our payment processor — we do not store full card numbers), support communications, and profile settings.</p>
          <p><strong className="text-white">Collected automatically:</strong> usage data, device and browser data, log data, and cookies.</p>
          <p><strong className="text-white">From connected devices:</strong> device identifiers, hardware model, firmware version, network connectivity status, screenshot thumbnails, and playback logs.</p>
        </ProseSection>

        <ProseSection title="3. How We Use Your Information">
          <p>We use personal information to: provide and improve the Service, manage accounts and authentication, handle billing and invoicing, send service notices and support responses, monitor service reliability, prevent fraud, comply with legal obligations, and analyze anonymized usage trends.</p>
          <p className="font-semibold text-white">We do not sell your personal information to third parties.</p>
        </ProseSection>

        <ProseSection title="4. How We Share Your Information">
          <p><strong className="text-white">Service Providers:</strong> We engage trusted third-party companies (cloud hosting, payment processors, email delivery, error monitoring) under written data processing agreements.</p>
          <p><strong className="text-white">Resellers:</strong> If your Organization was set up by a Reseller, that Reseller may have access to your account information as part of their authorized management role.</p>
          <p><strong className="text-white">Legal Requirements:</strong> We may disclose personal information where required by law, court order, or government authority.</p>
        </ProseSection>

        <ProseSection title="5. Data Retention">
          <p>We retain personal information as long as necessary to maintain your Account, comply with legal obligations (financial records: minimum 7 years), and resolve disputes. Device log data and screenshot thumbnails are retained for a rolling 90-day period by default.</p>
        </ProseSection>

        <ProseSection title="6. Data Security">
          <p>We implement appropriate technical and organizational measures including: encryption in transit (TLS) and at rest, access controls and role-based permissions, regular security assessments, and staff training. No method of electronic storage is 100% secure. Contact <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a> immediately if you believe your account has been compromised.</p>
        </ProseSection>

        <ProseSection title="7. Cookies and Tracking Technologies">
          <p>We use <strong className="text-white">essential cookies</strong> (authentication sessions, CSRF protection), <strong className="text-white">functional cookies</strong> (user preferences), and <strong className="text-white">analytics cookies</strong> (aggregate usage analysis). You can control cookies through your browser settings, though disabling some may affect Service functionality.</p>
        </ProseSection>

        <ProseSection title="8. International Data Transfers">
          <p>Nexari Technologies is based in Canada. Your information may be processed on servers in Canada, the United States, or the EEA where our service providers operate. We ensure appropriate safeguards are in place in accordance with applicable law.</p>
        </ProseSection>

        <ProseSection title="9. Children's Privacy">
          <p>The Service is not directed to individuals under the age of 16. We do not knowingly collect personal information from children. Contact <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a> if you believe a child has provided us with personal information.</p>
        </ProseSection>

        <ProseSection title="10. Your Privacy Rights">
          <p>Under PIPEDA and applicable Canadian provincial laws, you have the right to: access your personal information, request corrections, withdraw consent for non-essential processing, request deletion, and lodge a complaint with the Office of the Privacy Commissioner of Canada at <a href="https://www.priv.gc.ca" target="_blank" rel="noreferrer" className="text-[#3a7bff] hover:underline">www.priv.gc.ca</a>.</p>
          <p>Submit written requests to <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a>. We will respond within 30 days as required by PIPEDA.</p>
        </ProseSection>

        <ProseSection title="13. Changes to This Privacy Policy">
          <p>We may update this Privacy Policy from time to time. When we make material changes, we will update the "Last updated" date and notify registered Users by email or in-product notice. Your continued use of the Service constitutes acceptance of the revised policy.</p>
        </ProseSection>

        <ProseSection title="14. Contact Us — Privacy Officer">
          <p>
            <strong className="text-white">Nexari Technologies</strong><br />
            Email: <a href="mailto:support@nexari.ai" className="text-[#3a7bff] hover:underline">support@nexari.ai</a>
          </p>
          <p>
            <strong className="text-white">Office of the Privacy Commissioner of Canada</strong><br />
            <a href="https://www.priv.gc.ca" target="_blank" rel="noreferrer" className="text-[#3a7bff] hover:underline">www.priv.gc.ca</a> · 1-800-282-1376
          </p>
        </ProseSection>

        <div className="pt-8 border-t text-xs text-[#7a8299]" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          This Privacy Policy was last reviewed and updated on June 2, 2026.
        </div>
      </div>
    </div>
  );
}
