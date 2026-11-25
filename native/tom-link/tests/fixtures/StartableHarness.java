import com.tcg.pokemon.op.tom.Main;
import com.tcg.pokemon.op.tom.core.Pod;
import com.tcg.pokemon.op.tom.core.Round;
import com.tcg.pokemon.op.tom.core.Tournament;
import com.tcg.pokemon.op.tom.gui.core.application.AbstractApplicationManager;
import com.tcg.pokemon.op.tom.gui.database.TournamentsDatabase;
import java.io.File;
import java.nio.file.Files;
import javax.swing.SwingUtilities;

/**
 * tom-tdf's GuiHarness, except every pod's first round is left paired with
 * its pairings viewed, so TOM's main button reads "Start Round". Once the
 * test asks (an OTHER file), another TOM window becomes the active one, as
 * when TOM opens a second file in a window of its own.
 * Args: workDir masters [playedRounds]
 */
public class StartableHarness {
   public static void main(String[] a) throws Exception {
      File work = new File(a[0]).getAbsoluteFile();
      File home = new File(work, "home");
      GuiHarness.writeInstall(home, new File(work, "TOM_DATA"), 20);
      System.setProperty("user.home", home.getPath());

      int played = a.length > 2 ? Integer.parseInt(a[2]) : 0;
      Tournament t = GuiHarness.build(Tournament.TournamentMode.LEAGUECHALLENGE, Integer.parseInt(a[1]), 0, 0, 0, 1, played, false);
      for (Pod pod : t.getPods()) {
         Round round = pod.getCurrentRound();
         if (round.getStage() == 2) {
            round.nextStage();
         }
      }
      File tdf = new File(work, "event.tdf");
      TournamentsDatabase.saveTournament(t, tdf);

      Thread opener = new Thread(() -> GuiHarness.openAfterLogin(tdf, new File(work, "READY")));
      opener.setDaemon(true);
      opener.start();
      Thread other = new Thread(() -> activateAnother(work));
      other.setDaemon(true);
      other.start();
      Main.main(new String[0]);
   }

   static void activateAnother(File work) {
      try {
         while (!new File(work, "OTHER").exists()) {
            Thread.sleep(200);
         }
         SwingUtilities.invokeAndWait(() -> AbstractApplicationManager.getDefaultManager().createInternalInstance());
         Files.writeString(new File(work, "OTHER-READY").toPath(), "READY\n");
      } catch (Exception e) {
         e.printStackTrace();
      }
   }
}
