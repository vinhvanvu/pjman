# The Homebrew formula for pjman, written by the release (scripts/release.mjs) into the tap vinhvanvu/homebrew-pjman as
# Formula/pjman.rb after each publish, from the package the release put on npm. Never edited by hand: the next release
# overwrites it. __VERSION__ and __SHA256__ are filled in by the release.
class Pjman < Formula
  desc "Context graph for product development: changes, decisions, the product tree and agent sessions in git"
  homepage "https://github.com/vinhvanvu/pjman"
  url "https://registry.npmjs.org/@vinhvanvu/pjman/-/pjman-__VERSION__.tgz"
  sha256 "__SHA256__"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pjman --version")
  end
end
