<form id="tunings_drop" class="inputs" method="get" action="<?php echo $self; ?>"><select class="inputs" name="x"><?php  // FORM tunings dropdown -----------------------------------------------------------------------
if ( $x['z'] == "n" ) { $red_ = "class='red_fg'"; } else { $red_ = ""; }
echo "<option value='".$x['url_notes']."' ".$red_.">(".$x['strs']."-string) ".$x['name']." - ".$x[$rev.'notes']." - (".$x[$rev.'dgs'].")</option>";
foreach ( $tunings as $a => $b ) {echo "<option value='".$b['url_notes']."'>(".$b['strs']."-string) ".$b['name']." - ".$b[$rev.'notes']." - (".$b[$rev.'dgs'].")</option>"; 
} if ( $x['z'] == "y" ) { $checkers = "checked=checked"; } else { $checkers = ""; } ?></select><br/>Display tunings <?php echo $x[$rev.'yy']; ?>: <input type="checkbox" class="chxbx" name="y" value="y"<?php if( $x['y'] == "y" ){echo" checked=\"checked\"";} ?> /> &nbsp; &nbsp; &nbsp; &nbsp;Show custom tuning: <input id="cyo" class="cyo" class="chxbx" type="checkbox" name="z" value="y" <?php echo $checkers; ?> /> &nbsp; &nbsp; &nbsp; &nbsp;Key: <select class="inputs" name="k"><?php // FORM Key Dropdown --------------------------------------------------------------------------------------
echo "<option value='".urlencode( str_replace( "♯","#", $x['k'] ) )."'>".$x['k']."</option>"; 
foreach ( $allnotes as $a ) {
	echo "<option value='".urlencode( str_replace( "♯","#", $a ) )."'>".$a."</option>";
} 
?></select> &nbsp; &nbsp; &nbsp; &nbsp;<input class="inputs" type="submit" value="<-- Update Fretboard" /> <br/><span class="hl_title">Highlight: &nbsp; &nbsp;</span><?php // FORM degree highlighting checkboxes --------------------------------------------------------------------------------------
foreach( $degrees as $a ) {
	$a = str_replace( "♭", "b", $a );
	if( $x['hl_'.$a] == "y" ) { 
		$checked = "checked=checked";
	} else {
		$checked = "";
	} 
	$_id_ = $a;
	echo " &nbsp; &nbsp;".$a.$extensions[array_search($a,$degrees)].":<input type=\"checkbox\" class=\"chxbx\" id=\"_".$_id_."_\" name=\"hl\" value=\"".$a."\" ".$checked.">&nbsp; "; 
} ?><br/><br/><h3>Quick Highlight Links</h3><span class="hl_title">Scales: &nbsp; &nbsp;</span><?php // FORM quick highlight SCALES ------------------------------------------------------------------------------------------------
$id_x = "";
foreach ( $scales as $a => $b ) {
	if ( $x['hl_n'] == str_replace("_"," ",$a) ) { $id_x = "_x";$bb = ""; } else { $bb = $b; }
	echo "<a href=\"".$hilight_url.$bb."\"><div class='".$a."'id='hl_button".$id_x."'>".str_replace( "_", " ", $a )."</div></a>";
	$id_x = "";
} 
?><br/><span class="hl_title">Chords: &nbsp; &nbsp;</span><?php // FORM quick highlight CHORDS ------------------------------------------------------------------------------------------------
foreach ( $chords as $a => $b ) {
	if ( $x['hl_n'] == str_replace("_"," ",$a) ) { $id_x = "_x";$bb = ""; } else { $bb = $b; }
	echo "<a href=\"".$hilight_url.$bb."\"><div class='".$a."'id='hl_button".$id_x."'>".str_replace( "_", " ", $a )."</div></a>";
	$id_x = "";
} 
?>
